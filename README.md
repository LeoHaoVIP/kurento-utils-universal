[![License badge](https://img.shields.io/badge/license-Apache2-orange.svg)](http://www.apache.org/licenses/LICENSE-2.0)
[![Documentation badge](https://readthedocs.org/projects/fiware-orion/badge/?version=latest)](https://doc-kurento.readthedocs.io)
[![Docker badge](https://img.shields.io/docker/pulls/fiware/orion.svg)](https://hub.docker.com/r/fiware/stream-oriented-kurento/)
[![Support badge]( https://img.shields.io/badge/support-sof-yellowgreen.svg)](https://stackoverflow.com/questions/tagged/kurento)

[![][KurentoImage]][Kurento]

Copyright 2018 [Kurento]. Licensed under [Apache 2.0 License].

[Kurento]: https://kurento.org
[KurentoImage]: https://secure.gravatar.com/avatar/21a2a12c56b2a91c8918d5779f1778bf?s=120
[Apache 2.0 License]: http://www.apache.org/licenses/LICENSE-2.0

# Kurento Utils for Node.js and Browsers

*kurento-utils-js* is a browser library that can be used to simplify creation and handling of [RTCPeerConnection](https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection) objects, to control the browser’s [WebRTC API](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API). However, the official kurento-utils-js is no longer maintained, and problems might occur when using the official library.

This library is an optimized version of [kurento-utils-js](https://www.npmjs.com/package/kurento-utils/v/6.18.0), currently it adds supports for screen sharing and mixed media sharing for mainstream browsers (as well as Electron, since [v6.18.6](https://www.npmjs.com/package/kurento-utils-universal/v/6.18.6)) without extra plugins.

## Installation Instructions

Be sure to have installed [Node.js](https://nodejs.org/en/) in your system:

```bash
curl -sL https://deb.nodesource.com/setup_8.x | sudo -E bash -
sudo apt-get install -y nodejs
```

To install the library, it's recommended to do that from the [NPM repository](https://www.npmjs.com/package/kurento-utils-universal):

```bash
npm install kurento-utils-universal
```

Alternatively, you can download the code using git and install manually its dependencies:

```bash
git clone https://github.com/LeoHaoVIP/kurento-utils-universal.git
cd kurento-utils-universal
npm install
```

## Developing Instructions

### Quickly Shift

If you have read the [kurento-docs](https://doc-kurento.readthedocs.io/en/stable/features/kurento_utils_js.html) and already known how to build WebRTC applications with the official [kurento-utils-js](https://www.npmjs.com/package/kurento-utils/v/6.18.0), you can quickly enjoy the new features by replacing the official dependency item with `{"kurento-utils-universal": "latest"}` in your `package.json` file.

Compared to coding with the official library, the only action that you should make is to update the `sendSource` field when creating [WebRtcPeer](https://doc-kurento.readthedocs.io/en/stable/features/kurento_utils_js.html#webrtcpeer). Update details about `sendSource` are provided below.

### Updates on Official Library

- Update enumeration values of `sendSource`

    The official [kurento-utils-js](https://www.npmjs.com/package/kurento-utils/v/6.18.0) supports two kinds of send sources, which are `webcam` and `screen`. In this updated library, we have provided four commonly used sharing modes, which are `audio`|`screen`|`camera`|`mix`.
    
    When a user is sharing on `mix` mode, the camera and screen media are mixed into one single media stream via  [MultiStreamMixer](https://github.com/muaz-khan/MultiStreamsMixer).
    
    ![mix-demo.png](https://i.postimg.cc/rm3kJCxk/mix-demo.png)
    
- Add supports for free-plugin screen sharing
  
  Most browsers now naturally support `getDisplayMedia` for screen sharing. In this updated library, we utilized it and implemented `getScreenMedia`, thus users can share their screen without installing extra browser plugins.
  
  Besides, considering that some developers are writing WebRTC applications running on [Electron](https://www.electronjs.org/) framework, since [v6.18.6](https://www.npmjs.com/package/kurento-utils-universal/v/6.18.6), we also implemented `getScreenMediaForElectron` and `getMixMediaForElectron` using [desktopCapturer](https://www.electronjs.org/docs/latest/api/desktop-capturer) module of `Electron`.
  
  It's worth noting that developers don't need to make any extra actions or configuration to start screen sharing, the only thing that you should do is to assign `'screen'` or `'mix'` to the `sendSource` field.

### Screen Sharing on Electron

Screen sharing works perfectly on mainstream browsers, such as Chrome, Firefox, Microsoft Edge. When the [WebRtcPeer](https://doc-kurento.readthedocs.io/en/stable/features/kurento_utils_js.html#webrtcpeer) is created with `sendSource` as `'screen'` or `'mix'`, a window will pop up and ask user to select the target window (or the entire screen) to share.

![popup-window.png](https://i.postimg.cc/MGtbT2GW/popup-window.png)

However, Things get different when WebRTC applications are running on [Electron](https://www.electronjs.org/), since no popup window will show up.

In this library, we have implemented the basic screen sharing functionality for Electron applications. By default, the target sharing media source is the entire screen.

#### Sharing A Specific Window on Electron

If you want to share a specific window instead of the entire screen on Electron, some coordination is required. In this tutorial, we will show how to share a certain media source via the [Inter-Process Communication (IPC)](https://www.electronjs.org/docs/latest/tutorial/ipc) in Electron.

**Step1. Add a [Preload Script](https://www.electronjs.org/docs/latest/glossary#main-process) for you Electron application.**

```javascript
// preload.js | Electron project
let {ipcRenderer} = require('electron');

ipcRenderer.on('media-source-id', (event, value) => {
    // Write the target media source id to the window object
    window.mediaSourceId = value;
})
```

**Step2. Select a target media source via `desktopCapturer` in the [Main Process](https://www.electronjs.org/docs/latest/glossary#main-process) and send it to the [Renderer Process](https://www.electronjs.org/docs/latest/glossary#renderer-process).**

```javascript
// main.js | Electron project
const {app, desktopCapturer} = require('electron');

let mainWindow;

const createWindow = () => {
    mainWindow = new BrowserWindow({
        width: 800,
        height: 600,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            // Append other webPreferences if necessary
        }
    })
    // Add your window creation logic here
}

// Note: the desktopCapturer module only works when the app is ready
app.whenReady().then(() => {
    createWindow();
    desktopCapturer.getSources({types: ['window', 'screen']}).then(async sources => {
        let targetMediaSourceId;
        for (const source of sources) {
            // Add your media source selection logic here
            targetMediaSourceId = source.id;
        }
        // Send the target media source to the Renderer Process
        mainWindow.webContents.send('media-source-id', targetMediaSourceId);
    })
})
```

The next following is a sample of media source object.

```javascript
// A sample of media source object
{
  name: 'app',
  id: 'window:854492:1',
  thumbnail: NativeImage {...},
  display_id: '',
  appIcon: null
}
```

**Explanation**

When the  [kurento-utils-universal](https://www.npmjs.com/package/kurento-utils-universal) library is running on Electron, the `mediaSourceId` inside the  `window` object will be used as the target media source ID. Thus, developers need to preset the `mediaSourceId` in the `window` object, and then the library will start sharing the target media. The relevant codes in our library are as follows:

```javascript
screenConstrains.video = {
    mandatory: {
        chromeMediaSource: 'desktop',
        // Use the mediaSourceId (if provided) inside the window object.
        chromeMediaSourceId: window.mediaSourceId ? window.mediaSourceId : ''
    }
};
```

After finishing the above steps,  you can share a specific window media on Electron.


---

> The next following document is directly copied from official `kurento-utils` project.

---

About Kurento
=============

Kurento is an open source software project providing a platform suitable for creating modular applications with advanced real-time communication capabilities. For knowing more about Kurento, please visit the Kurento project website: https://www.kurento.org.

Kurento is part of [FIWARE]. For further information on the relationship of FIWARE and Kurento check the [Kurento FIWARE Catalog Entry]. Kurento is also part of the [NUBOMEDIA] research initiative.

[FIWARE]: http://www.fiware.org
[Kurento FIWARE Catalog Entry]: http://catalogue.fiware.org/enablers/stream-oriented-kurento
[NUBOMEDIA]: http://www.nubomedia.eu



Documentation
-------------

The Kurento project provides detailed [documentation] including tutorials, installation and development guides. The [Open API specification], also known as *Kurento Protocol*, is available on [apiary.io].

[documentation]: https://www.kurento.org/documentation
[Open API specification]: http://kurento.github.io/doc-kurento/
[apiary.io]: http://docs.streamoriented.apiary.io/



Useful Links
------------

Usage:

* [Installation Guide](https://doc-kurento.readthedocs.io/en/latest/user/installation.html)
* [Compilation Guide](https://doc-kurento.readthedocs.io/en/latest/dev/dev_guide.html#developing-kms)
* [Contribution Guide](https://doc-kurento.readthedocs.io/en/latest/project/contribute.html)

Issues:

* [Bug Tracker](https://github.com/LeoHaoVIP/kurento-utils-universal/issues)
* [Support](https://doc-kurento.readthedocs.io/en/latest/user/support.html)

News:

* [Kurento Blog](https://www.kurento.org/blog)
* [Google Groups](https://groups.google.com/forum/#!forum/kurento)



Source
------

All source code belonging to the Kurento project can be found in the [Kurento GitHub organization page].

[Kurento GitHub organization page]: https://github.com/Kurento



Licensing and distribution
--------------------------

Copyright 2018 Kurento

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
