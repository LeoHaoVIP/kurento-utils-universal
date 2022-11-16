[![License badge](https://img.shields.io/badge/license-Apache2-orange.svg)](http://www.apache.org/licenses/LICENSE-2.0)
[![Documentation badge](https://readthedocs.org/projects/fiware-orion/badge/?version=latest)](https://doc-kurento.readthedocs.io)
[![Docker badge](https://img.shields.io/docker/pulls/fiware/orion.svg)](https://hub.docker.com/r/fiware/stream-oriented-kurento/)
[![Support badge]( https://img.shields.io/badge/support-sof-yellowgreen.svg)](https://stackoverflow.com/questions/tagged/kurento)

[![][KurentoImage]][Kurento]

Copyright 2018 [Kurento]. Licensed under [Apache 2.0 License].

[Kurento]: https://kurento.org
[KurentoImage]: https://secure.gravatar.com/avatar/21a2a12c56b2a91c8918d5779f1778bf?s=120
[Apache 2.0 License]: http://www.apache.org/licenses/LICENSE-2.0



Kurento Utils for Node.js and Browsers
======================================

> Notes: 
> Source code can be found in [kurento-utils-github-repo](https://github.com/LeoHaoVIP/kurento-utils-universal)

*kurento-utils-js* is a browser library that can be used to simplify creation and handling of [RTCPeerConnection](https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection) objects, to control the browser’s [WebRTC API](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API). However, the official kurento-utils-js is no longer maintained, and problems might occur when using the official library.

This library is an optimized version of kurento-utils-js [v6.18.0](https://www.npmjs.com/package/kurento-utils/v/6.18.0), currently it adds supports for screen sharing for mainstream browsers (as well as Electron) without extra plugins.


Installation instructions
-------------------------

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

Updates on Official kurento-utils Library
======================================
- Update enum values of `sendSource`

    The official kurento-utils support two kinds of send sources, which are `webcam` and `screen`. In this updated library, we have provided four commonly used sharing modes, which are `audio`|`screen`|`camera`|`mix`.
    
    When a user is sharing on `mix` mode, the camera and screen media are mixed into one single media stream via  [MultiStreamMixer](https://github.com/muaz-khan/MultiStreamsMixer).
    
    [![mix-demo.png](https://i.postimg.cc/rm3kJCxk/mix-demo.png)](https://postimg.cc/ZB82YNw7)
    
- Add supports for free-plugin screen sharing
  
  Most browsers now naturally support `getDisplayMedia` for screen sharing. In this updated library, we utilized it and implemented `getScreenMedia`, thus users can share their screen without installing extra browser plugins. 
  
  Besides, considering that many developers are writing WebRTC codes on [Electron](https://www.electronjs.org/) framework, we also implemented `getScreenMediaForElectron` and `getMixMediaForElectron` using [desktopCapturer](https://www.electronjs.org/docs/latest/api/desktop-capturer) module of `Electron`.
  
  

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
