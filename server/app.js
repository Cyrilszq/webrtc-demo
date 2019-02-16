const ws = require('ws')
const https = require('https')
const fs = require('fs')

// 连接池
let clientLists = []
// 连接池保存一份 map 结构方便操作
let clientMap = {}

// 创建 websocket
const wss = new ws.Server({
  port: 4100
})

wss.on('connection', (ws) => {
  // 随机生成一个 userId
  const userId = parseInt(Math.random() * 10000)
  ws.userId = userId
  // 将该连接加入连接池
  clientLists.push(ws)
  clientMap[userId] = ws

  ws.send(JSON.stringify({
    type: 'userInfo',
    data: userId,
  }))

  // 广播通知所有客户端新的用户列表
  wss.clients.forEach((client) => {
    if (client.readyState === ws.OPEN) {
      const msg = {
        type: 'userList',
        data: Object.keys(clientMap),
      }
      client.send(JSON.stringify(msg))
    }
  })

  ws.on('message', (message) => {
    const data = JSON.parse(message)
    // 呼入
    if (data.type === 'call') {
      const { sourceUserId, targetUserId } = data.data
      clientMap[targetUserId].send(JSON.stringify({
        type: 'callIn',
        data: sourceUserId
      }))
    }
    // 挂断
    if (data.type === 'rejectCall') {
      const targetId = data.data
      clientMap[targetId].send(JSON.stringify({
        type: 'rejectCall',
      }))
    }
    if (data.type === 'acceptCall') {
      const targetId = data.data
      clientMap[targetId].send(JSON.stringify({
        type: 'acceptCall',
      }))
    }
    if (data.type === 'offer') {
      const { userId, offer } = data.data
      clientMap[userId].send(JSON.stringify({
        type: 'offer',
        data: offer,
      }))
    }
    if (data.type === 'answer') {
      const { userId, answer } = data.data
      clientMap[userId].send(JSON.stringify({
        type: 'answer',
        data: answer,
      }))
    }
    if (data.type === 'candidate') {
      const { userId, candidate } = data.data
      clientMap[userId].send(JSON.stringify({
        type: 'candidate',
        data: candidate,
      }))
    }
  })

  ws.on('close', (message) => {
    clientLists = clientLists.filter(x => x.userId !== ws.userId)
    delete clientMap[ws.userId]
  })
})