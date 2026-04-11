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
  
  socket.emit('chat history', messageHistory.slice(-100));
  
  socket.on('user join', (username) => {
    if (!username || username.trim() === '') return;
    
    username = username.trim();
    connectedUsers.set(socket.id, username);
    socket.username = username;
    
    const allUsers = Array.from(connectedUsers.values());
    io.emit('users list', allUsers);
    
    socket.broadcast.emit('user joined', {
      username: username,
      time: new Date().toLocaleTimeString()
    });
    
    console.log(`✅ ${username} присоединился`);
  });
  
  // Текстовое сообщение
  socket.on('chat message', (data) => {
    if (!data.username || !data.message) return;
    
    const time = new Date().toLocaleTimeString();
    const messageData = {
      type: 'text',
      username: data.username,
      message: data.message,
      time: time
    };
    
    messageHistory.push(messageData);
    if (messageHistory.length > 200) messageHistory.shift();
    
    io.emit('chat message', messageData);
  });
  
  // Голосовое сообщение
  socket.on('voice message', (data) => {
    if (!data.username || !data.audio) return;
    
    const time = new Date().toLocaleTimeString();
    const messageData = {
      type: 'voice',
      username: data.username,
      audio: data.audio,
      duration: data.duration,
      time: time
    };
    
    messageHistory.push(messageData);
    if (messageHistory.length > 200) messageHistory.shift();
    
    io.emit('chat message', messageData);
  });
  
  // Фото сообщение
  socket.on('image message', (data) => {
    if (!data.username || !data.image) return;
    
    const time = new Date().toLocaleTimeString();
    const messageData = {
      type: 'image',
      username: data.username,
      image: data.image,
      caption: data.caption || '',
      time: time
    };
    
    messageHistory.push(messageData);
    if (messageHistory.length > 200) messageHistory.shift();
    
    io.emit('chat message', messageData);
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