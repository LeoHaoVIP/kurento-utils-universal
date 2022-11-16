/*
 * (C) Copyright 2014-2015 Kurento (http://kurento.org/)
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
var freeice = require('freeice')
var inherits = require('inherits')
var UAParser = require('ua-parser-js')
var uuidv4 = require('uuid/v4')
var hark = require('hark')
var EventEmitter = require('events').EventEmitter
var recursive = require('merge').recursive.bind(undefined, true)
var sdpTranslator = require('sdp-translator')
var logger = (typeof window === 'undefined') ? console : window.Logger ||
    console
var MultiStreamsMixer = require('./MultiStreamsMixer');
var MEDIA_CONSTRAINTS = {
  audio: true,
  video: {
    width: {ideal: 1920},
    height: {ideal: 1080},
    framerate: 30
  }
}
// Somehow, the UAParser constructor gets an empty window object.
// We need to pass the user agent string in order to get information
var ua = (typeof window !== 'undefined' && window.navigator) ? window.navigator
    .userAgent : ''
var parser = new UAParser(ua)
var browser = parser.getBrowser()

function insertScriptSrcInHtmlDom(scriptSrc) {
  //Create a script tag
  var script = document.createElement('script');
  // Assign a URL to the script element
  script.src = scriptSrc;
  // Get the first script tag on the page (we'll insert our new one before it)
  var ref = document.querySelector('script');
  // Insert the new node before the reference node
  ref.parentNode.insertBefore(script, ref);
}

function importScriptsDependsOnBrowser() {
  insertScriptSrcInHtmlDom("https://cdn.temasys.io/adapterjs/0.15.x/adapter.debug.js");
}

importScriptsDependsOnBrowser();
var usePlanB = false
if (browser.name === 'Chrome' || browser.name === 'Chromium') {
  logger.debug(browser.name + ": using SDP PlanB")
  usePlanB = true
}

function noop(error) {
  if (error) logger.error(error)
}

function trackStop(track) {
  track.stop && track.stop()
}

function streamStop(stream) {
  stream.getTracks().forEach(trackStop)
}

/**
 * Returns a string representation of a SessionDescription object.
 */
var dumpSDP = function (description) {
  if (typeof description === 'undefined' || description === null) {
    return ''
  }
  return 'type: ' + description.type + '\r\n' + description.sdp
}

function bufferizeCandidates(pc, onerror) {
  var candidatesQueue = []

  function setSignalingstatechangeAccordingWwebBrowser(functionToExecute, pc) {
    pc.addEventListener('signalingstatechange', functionToExecute);
  }

  var signalingstatechangeFunction = function () {
    if (pc.signalingState === 'stable') {
      while (candidatesQueue.length) {
        var entry = candidatesQueue.shift();
        pc.addIceCandidate(entry.candidate, entry.callback, entry.callback);
      }
    }
  };
  setSignalingstatechangeAccordingWwebBrowser(signalingstatechangeFunction, pc);
  return function (candidate, callback) {
    callback = callback || onerror;
    switch (pc.signalingState) {
      case 'closed':
        callback(new Error('PeerConnection object is closed'));
        break;
      case 'stable':
        if (pc.remoteDescription) {
          pc.addIceCandidate(candidate, callback, callback);
          break;
        }
      default:
        candidatesQueue.push({
          candidate: candidate,
          callback: callback
        });
    }
  };
}

/* Simulcast utilities */
function removeFIDFromOffer(sdp) {
  var n = sdp.indexOf("a=ssrc-group:FID");
  if (n > 0) {
    return sdp.slice(0, n);
  } else {
    return sdp;
  }
}

function getSimulcastInfo(videoStream) {
  var videoTracks = videoStream.getVideoTracks();
  if (!videoTracks.length) {
    logger.warn('No video tracks available in the video stream')
    return ''
  }
  var lines = [
    'a=x-google-flag:conference',
    'a=ssrc-group:SIM 1 2 3',
    'a=ssrc:1 cname:localVideo',
    'a=ssrc:1 msid:' + videoStream.id + ' ' + videoTracks[0].id,
    'a=ssrc:1 mslabel:' + videoStream.id,
    'a=ssrc:1 label:' + videoTracks[0].id,
    'a=ssrc:2 cname:localVideo',
    'a=ssrc:2 msid:' + videoStream.id + ' ' + videoTracks[0].id,
    'a=ssrc:2 mslabel:' + videoStream.id,
    'a=ssrc:2 label:' + videoTracks[0].id,
    'a=ssrc:3 cname:localVideo',
    'a=ssrc:3 msid:' + videoStream.id + ' ' + videoTracks[0].id,
    'a=ssrc:3 mslabel:' + videoStream.id,
    'a=ssrc:3 label:' + videoTracks[0].id
  ];
  lines.push('');
  return lines.join('\n');
}

function sleep(milliseconds) {
  var start = new Date().getTime();
  for (var i = 0; i < 1e7; i++) {
    if ((new Date().getTime() - start) > milliseconds) {
      break;
    }
  }
}

function setIceCandidateAccordingWebBrowser(functionToExecute, pc) {
  pc.addEventListener('icecandidate', functionToExecute);
}

/**
 * Wrapper object of an RTCPeerConnection. This object is aimed to simplify the
 * development of WebRTC-based applications.
 *
 * @constructor module:kurentoUtils.WebRtcPeer
 *
 * @param {String} mode Mode in which the PeerConnection will be configured.
 *  Valid values are: 'recvonly', 'sendonly', and 'sendrecv'
 * @param localVideo Video tag for the local stream
 * @param remoteVideo Video tag for the remote stream
 * @param {MediaStream} videoStream Stream to be used as primary source
 */
function WebRtcPeer(mode, options, callback) {
  if (!(this instanceof WebRtcPeer)) {
    return new WebRtcPeer(mode, options, callback)
  }
  WebRtcPeer.super_.call(this)
  if (options instanceof Function) {
    callback = options
    options = undefined
  }
  options = options || {}
  callback = (callback || noop).bind(this)
  var self = this
  var localVideo = options.localVideo
  var remoteVideo = options.remoteVideo
  var remoteAudio = options.remoteAudio
  var videoStream = null
  //用于混流的工具
  var mixer = null
  var screenStreamForMixer = null;
  var cameraStreamForMixer = null;
  var mediaConstraints = options.mediaConstraints
  var pc = options.peerConnection
  var sendSource = options.sendSource || 'audio'
  var dataChannelConfig = options.dataChannelConfig
  var useDataChannels = options.dataChannels || false
  var dataChannel
  var guid = uuidv4()
  var configuration = recursive({
        iceServers: freeice()
      },
      options.configuration)
  var onicecandidate = options.onicecandidate
  if (onicecandidate) this.on('icecandidate', onicecandidate)
  var oncandidategatheringdone = options.oncandidategatheringdone
  if (oncandidategatheringdone) {
    this.on('candidategatheringdone', oncandidategatheringdone)
  }
  var simulcast = options.simulcast
  var multistream = options.multistream
  var interop = new sdpTranslator.Interop()
  var candidatesQueueOut = []
  var candidategatheringdone = false
  Object.defineProperties(this, {
    'peerConnection': {
      get: function () {
        return pc
      }
    },
    'id': {
      value: options.id || guid,
      writable: false
    },
    'remoteVideo': {
      get: function () {
        return remoteVideo
      }
    },
    'localVideo': {
      get: function () {
        return localVideo
      }
    },
    'dataChannel': {
      get: function () {
        return dataChannel
      }
    },
    'mixer': {
      get: function () {
        return mixer
      }
    },
  })
  // Init PeerConnection
  if (!pc) {
    pc = new RTCPeerConnection(configuration);
    if (useDataChannels && !dataChannel) {
      var dcId = 'WebRtcPeer-' + self.id
      var dcOptions = undefined
      if (dataChannelConfig) {
        dcId = dataChannelConfig.id || dcId
        dcOptions = dataChannelConfig.options
      }
      dataChannel = pc.createDataChannel(dcId, dcOptions);
      if (dataChannelConfig) {
        dataChannel.onopen = dataChannelConfig.onopen;
        dataChannel.onclose = dataChannelConfig.onclose;
        dataChannel.onmessage = dataChannelConfig.onmessage;
        dataChannel.onbufferedamountlow = dataChannelConfig.onbufferedamountlow;
        dataChannel.onerror = dataChannelConfig.onerror || noop;
      }
    }
  }
  // Shims over the now deprecated getLocalStreams() and getRemoteStreams()
  // (usage of these methods should be dropped altogether)
  getLocalStreams = function (pc) {
    var streams = [];
    var stream = new MediaStream();
    pc.getSenders().forEach(function (sender) {
      if (sender.track)
        stream.addTrack(sender.track);
    });
    if (stream.getTracks().length > 0)
      streams.push(stream);
    //这里需要同时将用于混流的相机和屏幕流包含进来，否则节点dispose()时不会关闭单独的媒体流，导致屏幕提示框不消失以及占用系统资源
    if (screenStreamForMixer)
      streams.push(screenStreamForMixer);
    if (cameraStreamForMixer)
      streams.push(cameraStreamForMixer);
    return streams;
  };
  getRemoteStreams = function (pc) {
    var stream = new MediaStream();
    pc.getReceivers().forEach(function (sender) {
      if (sender.track)
        stream.addTrack(sender.track);
    });
    return stream.getTracks().length > 0 ? [stream] : [];
  };
  // If event.candidate == null, it means that candidate gathering has finished
  // and RTCPeerConnection.iceGatheringState == "complete".
  // Such candidate does not need to be sent to the remote peer.
  // https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection/icecandidate_event#Indicating_that_ICE_gathering_is_complete
  var iceCandidateFunction = function (event) {
    var candidate = event.candidate;
    if (EventEmitter.listenerCount(self, 'icecandidate') || EventEmitter
        .listenerCount(self, 'candidategatheringdone')) {
      if (candidate) {
        var cand;
        if (multistream && usePlanB) {
          cand = interop.candidateToUnifiedPlan(candidate);
        } else {
          cand = candidate;
        }
        if (typeof AdapterJS === 'undefined') {
          self.emit('icecandidate', cand);
        }
        candidategatheringdone = false;
      } else if (!candidategatheringdone) {
        self.emit('candidategatheringdone');
        candidategatheringdone = true;
      }
    } else if (!candidategatheringdone) {
      candidatesQueueOut.push(candidate);
      if (!candidate)
        candidategatheringdone = true;
    }
  };
  setIceCandidateAccordingWebBrowser(iceCandidateFunction, pc);
  pc.ontrack = (e) => {
    remoteVideo.src
  }
  pc.onnegotiationneeded = options.onnegotiationneeded
  this.on('newListener', function (event, listener) {
    if (event === 'icecandidate' || event === 'candidategatheringdone') {
      while (candidatesQueueOut.length) {
        var candidate = candidatesQueueOut.shift()
        if (!candidate === (event === 'candidategatheringdone')) {
          listener(candidate)
        }
      }
    }
  })
  var addIceCandidate = bufferizeCandidates(pc)
  /**
   * Callback function invoked when an ICE candidate is received. Developers are
   * expected to invoke this function in order to complete the SDP negotiation.
   *
   * @function module:kurentoUtils.WebRtcPeer.prototype.addIceCandidate
   *
   * @param iceCandidate - Literal object with the ICE candidate description
   * @param callback - Called when the ICE candidate has been added.
   */
  this.addIceCandidate = function (iceCandidate, callback) {
    var candidate
    if (multistream && usePlanB) {
      candidate = interop.candidateToPlanB(iceCandidate)
    } else {
      candidate = new RTCIceCandidate(iceCandidate)
    }
    logger.debug('Remote ICE candidate received', iceCandidate)
    callback = (callback || noop).bind(this)
    addIceCandidate(candidate, callback)
  }
  this.generateOffer = function (callback) {
    callback = callback.bind(this)
    if (mode === 'recvonly') {
      /* Add reception tracks on the RTCPeerConnection. Send tracks are
       * unconditionally added to "sendonly" and "sendrecv" modes, in the
       * constructor's "start()" method, but nothing is done for "recvonly".
       *
       * Here, we add new transceivers to receive audio and/or video, so the
       * SDP Offer that will be generated by the PC includes these medias
       * with the "a=recvonly" attribute.
       */
      var useAudio =
          (mediaConstraints && typeof mediaConstraints.audio === 'boolean') ?
              mediaConstraints.audio : true
      var useVideo =
          (mediaConstraints && typeof mediaConstraints.video === 'boolean') ?
              mediaConstraints.video : true
      if (useAudio) {
        pc.addTransceiver('audio', {
          direction: 'recvonly'
        });
      }
      if (useVideo) {
        pc.addTransceiver('video', {
          direction: 'recvonly'
        });
      }
    } else if (mode === 'sendonly') {
      /* The constructor's "start()" method already added any available track,
       * which by default creates Transceiver with "sendrecv" direction.
       *
       * Here, we set all transceivers to only send audio and/or video, so the
       * SDP Offer that will be generated by the PC includes these medias
       * with the "a=sendonly" attribute.
       */
      pc.getTransceivers().forEach(function (transceiver) {
        transceiver.direction = "sendonly";
      });
    }
    pc.createOffer()
        .then(function (offer) {
          logger.debug('Created SDP offer');
          offer = mangleSdpToAddSimulcast(offer);
          return pc.setLocalDescription(offer);
        })
        .then(function () {
          var localDescription = pc.localDescription;
          logger.debug('Local description set\n', localDescription.sdp);
          if (multistream && usePlanB) {
            localDescription = interop.toUnifiedPlan(localDescription);
            logger.debug('offer::origPlanB->UnifiedPlan', dumpSDP(
                localDescription));
          }
          callback(null, localDescription.sdp, self.processAnswer.bind(
              self));
        })
        .catch(callback);
  }
  this.getLocalSessionDescriptor = function () {
    return pc.localDescription
  }
  this.getRemoteSessionDescriptor = function () {
    return pc.remoteDescription
  }

  function setRemoteStream() {
    var remoteStream = getRemoteStreams(pc)[0]
    if (remoteVideo) {
      var stream = new MediaStream();
      remoteVideo.pause()
      //提取视频轨道
      stream.addTrack(remoteStream.getVideoTracks()[0])
      remoteVideo.srcObject = stream
      remoteVideo.load();
    }
    if (remoteAudio) {
      var stream = new MediaStream();
      //记录音频当前播放状态用于恢复
      var paused = remoteAudio.paused && remoteAudio.srcObject;
      //提取音频轨道
      stream.addTrack(remoteStream.getAudioTracks()[0])
      remoteAudio.srcObject = stream
      remoteAudio.load();
      if (paused)
        remoteAudio.pause()
    }
  }

  this.setLocalStream = function () {
    if (videoStream && localVideo) {
      localVideo.srcObject = videoStream
    }
  };
  this.send = function (data) {
    if (dataChannel && dataChannel.readyState === 'open') {
      dataChannel.send(data)
    } else {
      logger.warn(
          'Trying to send data over a non-existing or closed data channel')
    }
  }
  /**
   * Callback function invoked when a SDP answer is received. Developers are
   * expected to invoke this function in order to complete the SDP negotiation.
   *
   * @function module:kurentoUtils.WebRtcPeer.prototype.processAnswer
   *
   * @param sdpAnswer - Description of sdpAnswer
   * @param callback -
   *            Invoked after the SDP answer is processed, or there is an error.
   */
  this.processAnswer = function (sdpAnswer, callback) {
    callback = (callback || noop).bind(this)
    var answer = new RTCSessionDescription({
      type: 'answer',
      sdp: sdpAnswer
    })
    if (multistream && usePlanB) {
      var planBAnswer = interop.toPlanB(answer)
      logger.debug('asnwer::planB', dumpSDP(planBAnswer))
      answer = planBAnswer
    }
    logger.debug('SDP answer received, setting remote description')
    if (pc.signalingState === 'closed') {
      return callback('PeerConnection is closed')
    }
    pc.setRemoteDescription(answer).then(function () {
          setRemoteStream()
          callback()
        },
        callback)
  }
  /**
   * Callback function invoked when a SDP offer is received. Developers are
   * expected to invoke this function in order to complete the SDP negotiation.
   *
   * @function module:kurentoUtils.WebRtcPeer.prototype.processOffer
   *
   * @param sdpOffer - Description of sdpOffer
   * @param callback - Called when the remote description has been set
   *  successfully.
   */
  this.processOffer = function (sdpOffer, callback) {
    callback = callback.bind(this)
    var offer = new RTCSessionDescription({
      type: 'offer',
      sdp: sdpOffer
    })
    if (multistream && usePlanB) {
      var planBOffer = interop.toPlanB(offer)
      logger.debug('offer::planB', dumpSDP(planBOffer))
      offer = planBOffer
    }
    logger.debug('SDP offer received, setting remote description')
    if (pc.signalingState === 'closed') {
      return callback('PeerConnection is closed')
    }
    pc.setRemoteDescription(offer).then(function () {
      return setRemoteStream()
    }).then(function () {
      return pc.createAnswer()
    }).then(function (answer) {
      answer = mangleSdpToAddSimulcast(answer)
      logger.debug('Created SDP answer')
      return pc.setLocalDescription(answer)
    }).then(function () {
      var localDescription = pc.localDescription
      if (multistream && usePlanB) {
        localDescription = interop.toUnifiedPlan(localDescription)
        logger.debug('answer::origPlanB->UnifiedPlan', dumpSDP(
            localDescription))
      }
      logger.debug('Local description set\n', localDescription.sdp)
      callback(null, localDescription.sdp)
    }).catch(callback)
  }

  function mangleSdpToAddSimulcast(answer) {
    if (simulcast) {
      if (browser.name === 'Chrome' || browser.name === 'Chromium') {
        logger.debug('Adding multicast info')
        answer = new RTCSessionDescription({
          'type': answer.type,
          'sdp': removeFIDFromOffer(answer.sdp) + getSimulcastInfo(
              videoStream)
        })
      } else {
        logger.warn('Simulcast is only available in Chrome browser.')
      }
    }
    return answer
  }

  /**
   * This function creates the RTCPeerConnection object taking into account the
   * properties received in the constructor. It starts the SDP negotiation
   * process: generates the SDP offer and invokes the onsdpoffer callback. This
   * callback is expected to send the SDP offer, in order to obtain an SDP
   * answer from another peer.
   */
  function start() {
    if (pc.signalingState === 'closed') {
      callback(
          'The peer connection object is in "closed" state. This is most likely due to an invocation of the dispose method before accepting in the dialogue'
      )
    }
    //显示本地视频
    self.setLocalStream()
    if (videoStream) {
      videoStream.getTracks().forEach(function (track) {
        pc.addTrack(track, videoStream);
      });
    }
    callback()
  }

  if (mode !== 'recvonly' && !videoStream) {
    function getAudioMedia(constraints) {
      if (constraints === undefined) {
        constraints = MEDIA_CONSTRAINTS
      }
      navigator.mediaDevices.getUserMedia(constraints).then(function (
          stream) {
        videoStream = stream;
        start();
      }).catch(callback);
    }

    function getCameraMedia(constraints) {
      if (constraints === undefined) {
        constraints = MEDIA_CONSTRAINTS
      }
      navigator.mediaDevices.getUserMedia(constraints).then(function (
          stream) {
        videoStream = stream;
        start();
      }).catch(callback);
    }

    /**
     * 适配electron屏幕分享
     * @param constraints
     */
    function getScreenMediaForElectron(constraints) {
      if (constraints === undefined) {
        constraints = MEDIA_CONSTRAINTS;
      }
      //获取音频选项，若在分享屏幕时音频选项打开，则应同时分享麦克风音频，而非系统音频
      const audioOn = constraints.audio;
      //深拷贝
      var screenConstrains = JSON.parse(JSON.stringify(constraints));
      //Electron要求屏幕分享时不能同时分享系统音频
      screenConstrains.audio = false;
      screenConstrains.video = {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: 'screen:0:0'
        }
      };
      navigator.mediaDevices.getUserMedia(screenConstrains).then(function (stream) {
        if (!audioOn) {
          videoStream = stream;
          start();
          return;
        }
        //若audio开启，则共享麦克风音频
        screenStreamForMixer = stream;
        //深拷贝
        var cameraConstrains = JSON.parse(JSON.stringify(constraints));
        cameraConstrains.video = false;
        navigator.mediaDevices.getUserMedia(cameraConstrains).then(function (stream) {
          cameraStreamForMixer = stream;
          videoStream = getMixedStream(screenStreamForMixer, cameraStreamForMixer);
          start();
        }).catch(callback);
      }).catch(callback);
    }

    function getScreenMedia(constraints) {
      if (constraints === undefined) {
        constraints = MEDIA_CONSTRAINTS;
      }
      //获取音频选项，若在分享屏幕时音频选项打开，则应同时分享麦克风音频，而非系统音频（用户可以在共享屏幕时选择是否同时共享系统音频）
      const audioOn = constraints.audio;
      navigator.mediaDevices.getDisplayMedia(constraints).then(function (stream) {
        if (!audioOn) {
          videoStream = stream;
          start();
          return;
        }
        //若audio开启，则共享麦克风音频
        screenStreamForMixer = stream;
        //深拷贝
        var cameraConstrains = JSON.parse(JSON.stringify(constraints));
        cameraConstrains.video = false;
        navigator.mediaDevices.getUserMedia(cameraConstrains).then(function (stream) {
          cameraStreamForMixer = stream;
          videoStream = getMixedStream(screenStreamForMixer, cameraStreamForMixer);
          start();
        }).catch(callback);
      }, callback);
    }

    /**
     * 适配electron混流媒体分享
     * @param constraints
     */
    function getMixMediaForElectron(constraints) {
      if (constraints === undefined) {
        constraints = MEDIA_CONSTRAINTS;
      }
      //深拷贝
      var cameraConstrains = JSON.parse(JSON.stringify(constraints));
      //默认相机画面分辨率选择640
      cameraConstrains.video.width = {ideal: 640}
      //深拷贝
      var screenConstrains = JSON.parse(JSON.stringify(constraints));
      //Electron要求屏幕分享时不能同时分享系统音频
      screenConstrains.audio = false;
      screenConstrains.video = {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: 'screen:0:0'
        }
      };
      navigator.mediaDevices.getUserMedia(screenConstrains).then(function (stream) {
        screenStreamForMixer = stream;
        navigator.mediaDevices.getUserMedia(cameraConstrains).then(function (stream) {
          cameraStreamForMixer = stream;
          videoStream = getMixedStream(screenStreamForMixer, cameraStreamForMixer);
          start();
        }).catch(callback);
      }).catch(callback);
    }

    function getMixMedia(constraints) {
      if (constraints === undefined) {
        constraints = MEDIA_CONSTRAINTS;
      }
      //深拷贝
      var cameraConstrains = JSON.parse(JSON.stringify(constraints));
      //默认相机画面分辨率选择640
      cameraConstrains.video.width = {ideal: 640}
      navigator.mediaDevices.getDisplayMedia(constraints).then(function (stream) {
        screenStreamForMixer = stream;
        navigator.mediaDevices.getUserMedia(cameraConstrains).then(function (stream) {
          cameraStreamForMixer = stream;
          videoStream = getMixedStream(screenStreamForMixer, cameraStreamForMixer);
          start();
        }).catch(callback);
      }, callback);

    }

    function getMixedStream(parentStream, childStream) {
      //获取parentStream的宽高和帧率
      const width = parentStream.getVideoTracks()[0].getSettings().width;
      const height = parentStream.getVideoTracks()[0].getSettings().height;
      const frameRate = parentStream.getVideoTracks()[0].getSettings().frameRate;
      parentStream.fullcanvas = true;
      parentStream.width = width;
      parentStream.height = height;
      //若childStream包含视频轨道，则嵌入
      if (childStream.getVideoTracks().length !== 0) {
        //获取子元素的宽高比
        const childRatio = childStream.getVideoTracks()[0].getSettings().width / childStream.getVideoTracks()[0].getSettings().height;
        childStream.height = parseInt(0.2 * height);
        //保持子元素的宽高比
        childStream.width = childRatio * childStream.height;
        //固定在父元素的左上角
        childStream.top = 0;
        childStream.left = 0;
      }
      mixer = new MultiStreamsMixer([parentStream, childStream]);
      mixer.frameInterval = frameRate;
      mixer.startDrawingFrames();
      return mixer.getMixedStream();
    }

    switch (sendSource) {
      case 'audio':
        getAudioMedia(mediaConstraints);
        break;
      case 'screen':
        if (browser.name === 'Electron') {
          getScreenMediaForElectron(mediaConstraints);
        } else {
          getScreenMedia(mediaConstraints);
        }
        break;
      case 'camera':
        getCameraMedia(mediaConstraints);
        break;
      case 'mix':
        if (browser.name === 'Electron') {
          getMixMediaForElectron(mediaConstraints);
        } else {
          getMixMedia(mediaConstraints);
        }
        break;
      default:
        break;
    }
  } else {
    setTimeout(start, 0)
  }
  this.on('_dispose', function () {
    if (localVideo) {
      localVideo.pause();
      localVideo.srcObject = null;
      if (typeof AdapterJS === 'undefined') {
        localVideo.load();
      }
    }
    if (remoteVideo) {
      remoteVideo.pause();
      remoteVideo.srcObject = null;
      if (typeof AdapterJS === 'undefined') {
        remoteVideo.load();
      }
    }
    //停止混流
    if (mixer) {
      mixer.releaseStreams();
    }
    self.removeAllListeners();
    if (typeof window !== 'undefined' && window.cancelChooseDesktopMedia !==
        undefined) {
      window.cancelChooseDesktopMedia(guid)
    }
  })
}

inherits(WebRtcPeer, EventEmitter)

function createEnableDescriptor(type) {
  var method = 'get' + type + 'Tracks'
  return {
    enumerable: true,
    get: function () {
      if (!this.peerConnection) return
      var streams = getLocalStreams(this.peerConnection)
      if (!streams.length) return
      for (var i = 0, stream; stream = streams[i]; i++) {
        var tracks = stream[method]()
        for (var j = 0, track; track = tracks[j]; j++)
          if (!track.enabled) return false
      }
      return true
    },
    set: function (value) {
      function trackSetEnable(track) {
        track.enabled = value
      }

      getLocalStreams(this.peerConnection).forEach(function (stream) {
        stream[method]().forEach(trackSetEnable)
      })
    }
  }
}

Object.defineProperties(WebRtcPeer.prototype, {
  'enabled': {
    enumerable: true,
    get: function () {
      return this.audioEnabled && this.videoEnabled
    },
    set: function (value) {
      this.audioEnabled = this.videoEnabled = value
    }
  },
  'audioEnabled': createEnableDescriptor('Audio'),
  'videoEnabled': createEnableDescriptor('Video')
})
WebRtcPeer.prototype.getLocalStream = function (index) {
  if (this.peerConnection) {
    return getLocalStreams(this.peerConnection)[index || 0]
  }
}
WebRtcPeer.prototype.getRemoteStream = function (index) {
  if (this.peerConnection) {
    return getRemoteStreams(this.peerConnection)[index || 0]
  }
}
/**
 * @description This method frees the resources used by WebRtcPeer.
 *
 * @function module:kurentoUtils.WebRtcPeer.prototype.dispose
 */
WebRtcPeer.prototype.dispose = function () {
  logger.debug('Disposing WebRtcPeer')
  var pc = this.peerConnection
  var dc = this.dataChannel
  var mixer = this.mixer
  try {
    if (dc) {
      if (dc.readyState === 'closed') return
      dc.close()
    }
    if (pc) {
      if (pc.signalingState === 'closed') return
      getLocalStreams(pc).forEach(streamStop)
      pc.close()
    }
    //停止混流
    if (mixer) {
      mixer.releaseStreams();
    }
  } catch (err) {
    logger.warn('Exception disposing webrtc peer ' + err)
  }
  if (typeof AdapterJS === 'undefined') {
    this.emit('_dispose');
  }
}
//
// Specialized child classes
//
function WebRtcPeerRecvonly(options, callback) {
  if (!(this instanceof WebRtcPeerRecvonly)) {
    return new WebRtcPeerRecvonly(options, callback)
  }
  WebRtcPeerRecvonly.super_.call(this, 'recvonly', options, callback)
}

inherits(WebRtcPeerRecvonly, WebRtcPeer)

function WebRtcPeerSendonly(options, callback) {
  if (!(this instanceof WebRtcPeerSendonly)) {
    return new WebRtcPeerSendonly(options, callback)
  }
  WebRtcPeerSendonly.super_.call(this, 'sendonly', options, callback)
}

inherits(WebRtcPeerSendonly, WebRtcPeer)

function WebRtcPeerSendrecv(options, callback) {
  if (!(this instanceof WebRtcPeerSendrecv)) {
    return new WebRtcPeerSendrecv(options, callback)
  }
  WebRtcPeerSendrecv.super_.call(this, 'sendrecv', options, callback)
}

inherits(WebRtcPeerSendrecv, WebRtcPeer)

function harkUtils(stream, options) {
  return hark(stream, options);
}

exports.bufferizeCandidates = bufferizeCandidates
exports.WebRtcPeerRecvonly = WebRtcPeerRecvonly
exports.WebRtcPeerSendonly = WebRtcPeerSendonly
exports.WebRtcPeerSendrecv = WebRtcPeerSendrecv
exports.hark = harkUtils
