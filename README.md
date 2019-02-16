# 利用 WebRTC 实现点对点视频

WebRTC 可以用来实现两个设备之间实时、点对点的音视频通信，目前在教育、医疗场景用的比较多。作为一个前端，我带着一颗好奇心研究了一下如何在浏览器实现音视频通信。体验地址：https://webrtc.cyrilszq.cn  可打开两个 tab 或用电脑加手机，如果在两个不同的网络环境需要走 sturn/turn server，由于云服务器用的台湾节点测了一下会有较大延迟:)

## 几个关键词
关于使用 WebRTC 搭建点对点视频首先有几个关键词要了解：
1. [NAT](https://zh.wikipedia.org/wiki/%E7%BD%91%E7%BB%9C%E5%9C%B0%E5%9D%80%E8%BD%AC%E6%8D%A2)
主要为了解决 IPv4 地址短缺问题，不细说了，应该都懂得。
- ICE（Interactive Connectivity Establishment）
是一个允许你的浏览器和对端浏览器建立连接的协议框架。主要利用 STUN/TURN 服务器来进行 NAT 穿透，WebRTC 将整个穿透过程封装在 RTCPeerConnection API 中，大大简化整个交互流程。
3. STUN（Session Traversal Utilities for NAT）
它是一个允许位于 NAT 后的客户端找出自己的公网地址的协议，整个交互如下图所示：

客户端 A 向 STUN 服务器发起一个请求，服务器会记录收到的 IP 地址及端口，并回传给客户端，此时客户端就得到了自己的 NAT 网关的 IP，同理客户端 B 也用相同的方式获取到自己 NAT 网关的IP，由此双方可以进行通信。

4. TURN（Traversal Using Relays around NAT）
针对 [对称型NAT](https://zh.wikipedia.org/wiki/%E7%BD%91%E7%BB%9C%E5%9C%B0%E5%9D%80%E8%BD%AC%E6%8D%A2) 是无法使用 STUN 协议实现穿透，此时需要一个中继服务器来转发双方所有的数据。你需要在 TURN 服务器上创建一个连接，然后告诉所有对端设备发包到服务器上，TURN 服务器再把包转发给你。很显然这种方式是开销很大的，所以只有在没得选择的情况下采用。

5. SDP
是一个描述多媒体连接内容的协议，例如分辨率，格式，编码，加密算法等，在视频流传输之前两端需要了解对方使用的格式，编码，加密算法等。

6. RTCPeerConnection
RTCPeerConnection 是 WebRTC 提供的一个 API，它代表一个由本地计算机到远端的 WebRTC 连接。该接口提供了创建，保持，监控，关闭连接的方法。利用 RTCPeerConnection 传输视频流之前要对其进行初始化，主要包括两件事：1. 交换双方的 SDP 信息；2. 确定 P2P 连接方式，即确定 candidate。

## 如何实现？

## 1. 搭建信令服务
WebRTC 的 RTCPeerConnection 负责多媒体串流的传送，但除此之外还需要一种机制用于传送双方建立连接用的信令（signaling），信令中会包括 1. session 控制信息用于建立和断开连接；2. 设备的解码器，视频的格式（即上面提到的 SDP）等信息。WebRTC 本身没有规定用什么方式传送信令，例如 SIP，Socket 任何可以双向通信的协议都可以来传送信令。下面就用熟悉的 WebSocket 来实现一个 Signaling Server，并完成双方信息交换，整个流程大概如下图所示：

大致代码如下：
```js
// 场景为用户 A 呼叫用户 B
// 1. 初始化 RTCPeerConnection 及 WebSocket
this.pc = new window.RTCPeerConnection({
  iceServers: [
    {
      url: 'stun:webrtc.cyrilszq.cn:3478'
    },
    {
      url: 'turn:webrtc.cyrilszq.cn:3479',
      // password
      credential: 'qwertyui',
      username: 'cyrilszq'
    },
  ]
})
// 监听 candidate，当有可用的 candidate 时利用 ws 发送给对方
this.pc.onicecandidate = (event) => {
  if (!event.candidate) return
  this.ws.send(JSON.stringify({
    // ws message 类型
    type: 'candidate',
    data: {
      candidate: event.candidate,
    }
  }))
}
// 收到对方的视频流
this.pc.onaddstream = (event) => {
  // 用 video 展示对方
  this.remoteVideo.srcObject = event.stream
}
// 初始化 WebSocket
this.ws = new WebSocket('wss://webrtc.cyrilszq.cn/websocket')
this.ws.onmessage = async (e) => {
  // 收到信息处理进行处理
  if (data.type === 'candidate') {
    // 为 RTCPeerConnection 添加 candidate，会自动挑选合适的 candidate 进行 P2P 连接
    this.pc.addIceCandidate(new RTCIceCandidate(data.data))
  }
  if (data.type === 'offer') {
    // 用户 B 收到 A 的 offer 后，设置自己的 remoteDescription & localDescription
    await this.pc.setRemoteDescription(new RTCSessionDescription(data.data))
    const answer = await this.pc.createAnswer()
    await this.pc.setLocalDescription(new RTCSessionDescription(answer))
    // 给 A 传递 answer
    this.ws.send(JSON.stringify({
      type: 'answer',
      data: {
        answer,
      },
    }))
  }
  // A 收到 answer 后设置 remoteDescription，至此双方都得到了对方的 SDP
  if (data.type === 'answer') {
    this.pc.setRemoteDescription(new RTCSessionDescription(data.data))
  }
}

// 2. 用户A 呼叫 用户B

// 开启音视频
const mediaStream = await window.navigator.mediaDevices.getUserMedia({ video: true, audio: true })
// 展示自己
this.localVideo.srcObject = mediaStream
// 添加视频流到 RTCPeerConnection
mediaStream.getTracks().forEach(track => this.pc.addTrack(track, mediaStream))
// 创建 offer，即上面提到的 SDP
const offer = await this.pc.createOffer()
// 设置本机A offer
await this.pc.setLocalDescription(offer)
this.ws.send(JSON.stringify({
  type: 'offer',
  data: {
    offer,
  },
}))
```
完整代码在[github.com/Cyrilszq...](https://github.com/Cyrilszq/webrtc-demo)

### 2.搭建 STURN/TURN
上面初始化的 RTCPeerConnection iceServers 是哪来的？可以用网上有一些公开的 [STURN/TURN Server](https://gist.github.com/sagivo/3a4b2f2c7ac6e1b5267c2f1f59ac6c6b)，但因为有免费的 [GCP 云服务器](https://cloud.google.com/free/?hl=zh-cn)，我还是选择自己搭了一个，搭建过程参考：https://github.com/coturn/coturn，https://www.pressc.cn/967.html 利用 coturn 在 linux 环境下搭建还是比较简单的，搭建完成后会得到 stun/turn 服务的 url， 使用时只需在 RTCPeerConnection 传入配置，如：
```js
this.pc = new window.RTCPeerConnection({
  iceServers: [
    {
      url: 'stun:webrtc.cyrilszq.cn:3478'
    },
    {
      url: 'turn:webrtc.cyrilszq.cn:3479',
      credential: 'qwertyui',
      username: 'cyrilszq'
    },
  ]
})
```
RTCPeerConnection 会首先尝试直接连接（在同一个局域网可直接成功），如果失败会依次读取 iceServers 的配置利用 STUN/TURN 实现 NAT 穿透，并找到最佳连接方式（cecandidate）。


## 更多有趣的事
