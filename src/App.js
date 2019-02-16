import React, { Component } from 'react';
import { Button, NavBar, Modal, ActivityIndicator, Toast } from 'antd-mobile';

// 页面状态
const PAGE_STATUS = {
  // 列表
  LIST: 'LIST',
  // 等待接通
  WAITING_CONNENCT: 'WAITING_CONNENCT',
  // 已接通
  CONNENCTED: 'CONNENCTED'
}

class App extends Component {

  state = {
    // 我的id
    myUserId: '',
    // 已连接的用户列表
    userList: [],
    status: PAGE_STATUS.LIST,
    // 拨过来的用户id
    sourceUserId: '',
    // 拨打到的用户id
    targetUserId: '',
  }

  // WebSocket 实例
  ws = null
  // RTCPeerConnection 实例
  pc = null

  candidateList = []

  componentDidMount() {
    this.initWebSocket()
    this.initRTCPeerConnection()
  }

  initWebSocket = () => {
    this.ws = new WebSocket('wss://webrtc.cyrilszq.cn/websocket')
    this.ws.onmessage = async (e) => {
      const data = JSON.parse(e.data)
      // 当前用户信息
      if (data.type === 'userInfo') {
        this.setState({ myUserId: data.data })
      }
      // 用户列表1
      if (data.type === 'userList') {
        this.setState({ userList: data.data.filter(x => +x !== this.state.myUserId) })
      }
      // 被呼入
      if (data.type === 'callIn') {
        this.setState({
          sourceUserId: data.data,
          status: PAGE_STATUS.WAITING_CONNENCT,
        })
      }
      // 挂断
      if (data.type === 'rejectCall') {
        Toast.info('对方已挂断')
        this.setState({
          modalVisible: false,
          status: PAGE_STATUS.LIST,
        })
      }
      // 呼叫后被对方接通
      if (data.type === 'acceptCall') {
        this.setState({
          modalVisible: false,
          status: PAGE_STATUS.CONNENCTED,
        })
        // 开启视频
        const mediaStream = await window.navigator.mediaDevices.getUserMedia({ video: true, audio: true })
        // 设置自己视角
        this.sourceVideoRef.srcObject = mediaStream
        this.mediaStream = mediaStream
        mediaStream.getTracks().forEach(track => this.pc.addTrack(track, mediaStream))
        // 1. 呼叫方创建 offer， 发送给对方
        const offer = await this.pc.createOffer()
        console.log('1. 呼叫方创建 offer， 发送给对方')
        await this.pc.setLocalDescription(offer)
        this.ws.send(JSON.stringify({
          type: 'offer',
          data: {
            userId: this.state.targetUserId,
            offer: this.pc.localDescription,
          },
        }))
      }
      // 3. 呼叫方收到应答，处理应答 
      if (data.type === 'answer') {
        console.log('3. 呼叫方收到应答，处理应答 ')
        this.pc.setRemoteDescription(new RTCSessionDescription(data.data))
      }
      // 2. 对方收到 offer 给出回应
      if (data.type === 'offer') {
        await this.pc.setRemoteDescription(new RTCSessionDescription(data.data))
        const answer = await this.pc.createAnswer()
        await this.pc.setLocalDescription(new RTCSessionDescription(answer))
        console.log('2. 对方收到 offer 给出回应')
        this.ws.send(JSON.stringify({
          type: 'answer',
          data: {
            userId: this.state.sourceUserId,
            answer,
          },
        }))
      }
      if (data.type === 'candidate') {
        console.log('添加candidate')
        this.pc.addIceCandidate(new RTCIceCandidate(data.data))
      }
    }
  }

  initRTCPeerConnection = () => {
    // https://gist.github.com/sagivo/3a4b2f2c7ac6e1b5267c2f1f59ac6c6b
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
    // 将 candidate 发送给对方
    this.pc.onicecandidate = (event) => {
      if (!event.candidate) return
      const { sourceUserId, myUserId, targetUserId } = this.state
      console.log('将 candidate 发送给', +sourceUserId === +myUserId ? targetUserId : sourceUserId)
      this.ws.send(JSON.stringify({
        type: 'candidate',
        data: {
          candidate: event.candidate,
          userId: sourceUserId === myUserId ? targetUserId : sourceUserId,
        }
      }))
    }
    this.pc.onaddstream = (event) => {
      console.log('接收到视频流')
      this.targetVideoRef.srcObject = event.stream
    }
    this.pc.oniceconnectionstatechange = () => {
      if (this.pc.iceConnectionState === 'disconnected') {
        Toast.info('对方已挂断')
        this.targetVideoRef.srcObject = null
        this.mediaStream.getVideoTracks()[0].stop()
        this.setState({ status: PAGE_STATUS.LIST })
      }
    }
  }

  handleAcceptConnect = () => {
    const { sourceUserId } = this.state
    this.setState({
      status: PAGE_STATUS.CONNENCTED,
    })
    this.ws.send(JSON.stringify({
      type: 'acceptCall',
      data: sourceUserId,
    }))
    window.navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      .then((mediaStream) => {
        this.mediaStream = mediaStream
        this.sourceVideoRef.srcObject = mediaStream
        mediaStream.getTracks().forEach(track => this.pc.addTrack(track, mediaStream))
      })
  }

  handleCall = (targetUserId) => {
    const { myUserId } = this.state
    this.ws.send(JSON.stringify({
      type: 'call',
      data: {
        sourceUserId: myUserId,
        targetUserId,
      }
    }))
    this.setState({
      modalVisible: true,
      sourceUserId: myUserId,
      targetUserId,
    })
  }

  handleCancelCall = (rejectCallUserId) => {
    this.setState({
      status: PAGE_STATUS.LIST,
      modalVisible: false
    })
    this.ws.send(JSON.stringify({
      type: 'rejectCall',
      data: rejectCallUserId
    }))
  }

  handleHangup = () => {

  }

  render() {
    const { myUserId, userList, status, modalVisible, sourceUserId, targetUserId } = this.state
    if (status === PAGE_STATUS.LIST) {
      return (
        <div className="list-container">
          <NavBar mode="light">当前userId: {myUserId}</NavBar>
          <ul className="list">
            {
              userList.map(userId =>
                <li onClick={() => { this.handleCall(userId) }}>userId: {userId}</li>  
              )
            }
          </ul>
          <Modal
            visible={modalVisible}
            transparent
            maskClosable={false}
            onClose={() => { this.setState({ modalVisible: false }) }}
            title="提示"
            footer={[{ text: '挂断', onPress: () => { this.handleCancelCall(targetUserId) } }]}
          >
            <div style={{ height: 100, overflow: 'scroll' }}>
              <ActivityIndicator text="正在呼叫，请等待..." animating />
            </div>
          </Modal>
        </div>
      );
    }
    if (status === PAGE_STATUS.WAITING_CONNENCT) {
      return (
        <div className="connecting-container">
          <NavBar mode="light">当前userId: {myUserId}</NavBar>
          <Button onClick={this.handleAcceptConnect}>接通</Button>
          <Button onClick={() => { this.handleCancelCall(sourceUserId) }}>拒绝</Button>
        </div>
      );
    }
    if (status === PAGE_STATUS.CONNENCTED) {
      return (
        <div>
          <NavBar mode="light">当前userId: {myUserId}</NavBar>
          <video className="target-video" autoPlay playsInline ref={x => this.targetVideoRef = x} />
          <video className="origin-video" autoPlay playsInline ref={x => this.sourceVideoRef = x} />
          {/* <Button onClick={this.handleHangup}>挂断</Button> */}
        </div>
      )
    }
  }
}

export default App;
