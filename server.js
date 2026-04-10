const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const connectedUsers = new Map();
const messageHistory = [];

io.on('connection', (socket) => {
  console.log('Новое подключение:', socket.id);
  
  socket.emit('chat history', messageHistory.slice(-50));
  
  socket.on('user join', (username) => {
    if (!username || username.trim() === '') return;
    
    username = username.trim();
    connectedUsers.set(socket.id, username);
    
    const allUsers = Array.from(connectedUsers.values());
    io.emit('users list', allUsers);
    
    socket.broadcast.emit('user joined', {
      username: username,
      time: new Date().toLocaleTimeString()
    });
    
    console.log(`✅ ${username} присоединился`);
  });
  
  socket.on('chat message', (data) => {
    if (!data.username || !data.message) return;
    
    const time = new Date().toLocaleTimeString();
    const messageData = {
      username: data.username,
      message: data.message,
      time: time
    };
    
    messageHistory.push(messageData);
    if (messageHistory.length > 100) messageHistory.shift();
    
    io.emit('chat message', messageData);
  });
  
  // ========== ЗВОНКИ ==========
  
  socket.on('call user', (data) => {
    const { targetUsername, callerUsername, offer } = data;
    
    // Находим сокет собеседника
    let targetSocketId = null;
    for (const [id, name] of connectedUsers.entries()) {
      if (name === targetUsername) {
        targetSocketId = id;
        break;
      }
    }
    
    if (targetSocketId) {
      // Сохраняем кто кому звонит
      socket.callTarget = targetSocketId;
      
      io.to(targetSocketId).emit('incoming call', {
        from: callerUsername,
        fromId: socket.id,
        offer: offer
      });
      
      console.log(`📞 ${callerUsername} звонит ${targetUsername}`);
    } else {
      socket.emit('call error', 'Пользователь не в сети');
    }
  });
  
  socket.on('answer call', (data) => {
    const { toId, answer } = data;
    io.to(toId).emit('call answered', { answer: answer });
  });
  
  socket.on('ice candidate', (data) => {
    const { toId, candidate } = data;
    io.to(toId).emit('ice candidate', { candidate: candidate });
  });
  
  socket.on('end call', (data) => {
    const { toId } = data;
    io.to(toId).emit('call ended');
  });
  
  socket.on('reject call', (data) => {
    const { toId } = data;
    io.to(toId).emit('call rejected');
  });
  
  socket.on('disconnect', () => {
    const username = connectedUsers.get(socket.id);
    if (username) {
      connectedUsers.delete(socket.id);
      
      const allUsers = Array.from(connectedUsers.values());
      io.emit('users list', allUsers);
      
      socket.broadcast.emit('user left', {
        username: username,
        time: new Date().toLocaleTimeString()
      });
      
      console.log(`❌ ${username} отключился`);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Мессенджер запущен на порту ${PORT}`);
  console.log(`🌐 Открой: http://localhost:${PORT}`);
});