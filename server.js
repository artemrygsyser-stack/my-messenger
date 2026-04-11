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
  },
  pingTimeout: 60000,
  pingInterval: 25000
});

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const connectedUsers = new Map(); // socket.id -> username
const userSockets = new Map(); // username -> socket.id
const messageHistory = [];
let messageId = 0;

io.on('connection', (socket) => {
  console.log('Новое подключение:', socket.id);
  
  socket.emit('chat history', messageHistory.slice(-100));
  
  socket.on('user join', (username) => {
    if (!username || username.trim() === '') return;
    
    username = username.trim();
    
    // Если пользователь уже был с другим сокетом - удаляем старый
    if (userSockets.has(username)) {
      const oldSocketId = userSockets.get(username);
      if (oldSocketId !== socket.id) {
        io.to(oldSocketId).emit('force disconnect');
        connectedUsers.delete(oldSocketId);
      }
    }
    
    connectedUsers.set(socket.id, username);
    userSockets.set(username, socket.id);
    socket.username = username;
    
    const allUsers = Array.from(connectedUsers.values());
    io.emit('users list', allUsers);
    
    socket.broadcast.emit('user joined', {
      username: username,
      time: new Date().toLocaleTimeString()
    });
    
    console.log(`✅ ${username} присоединился. Онлайн: ${allUsers.length}`);
  });
  
  // Текстовое сообщение
  socket.on('chat message', (data) => {
    if (!data.username || !data.message) return;
    
    messageId++;
    const time = new Date().toLocaleTimeString();
    const messageData = {
      id: messageId,
      type: 'text',
      username: data.username,
      message: data.message,
      replyTo: data.replyTo || null,
      edited: false,
      editedAt: null,
      time: time,
      timestamp: Date.now()
    };
    
    messageHistory.push(messageData);
    if (messageHistory.length > 500) messageHistory.shift();
    
    io.emit('chat message', messageData);
  });
  
  // Редактирование сообщения
  socket.on('edit message', (data) => {
    const { messageId: editId, newMessage } = data;
    const msgIndex = messageHistory.findIndex(m => m.id === editId);
    
    if (msgIndex !== -1 && messageHistory[msgIndex].username === socket.username) {
      messageHistory[msgIndex].message = newMessage;
      messageHistory[msgIndex].edited = true;
      messageHistory[msgIndex].editedAt = new Date().toLocaleTimeString();
      io.emit('message edited', {
        id: editId,
        message: newMessage,
        editedAt: messageHistory[msgIndex].editedAt
      });
    }
  });
  
  // Удаление сообщения
  socket.on('delete message', (data) => {
    const { messageId: deleteId } = data;
    const msgIndex = messageHistory.findIndex(m => m.id === deleteId);
    
    if (msgIndex !== -1 && messageHistory[msgIndex].username === socket.username) {
      messageHistory[msgIndex].deleted = true;
      messageHistory[msgIndex].message = 'Сообщение удалено';
      io.emit('message deleted', { id: deleteId });
    }
  });
  
  // Голосовое сообщение
  socket.on('voice message', (data) => {
    if (!data.username || !data.audio) return;
    
    messageId++;
    const time = new Date().toLocaleTimeString();
    const messageData = {
      id: messageId,
      type: 'voice',
      username: data.username,
      audio: data.audio,
      duration: data.duration,
      replyTo: data.replyTo || null,
      time: time,
      timestamp: Date.now()
    };
    
    messageHistory.push(messageData);
    if (messageHistory.length > 500) messageHistory.shift();
    
    io.emit('chat message', messageData);
  });
  
  // Фото сообщение
  socket.on('image message', (data) => {
    if (!data.username || !data.image) return;
    
    messageId++;
    const time = new Date().toLocaleTimeString();
    const messageData = {
      id: messageId,
      type: 'image',
      username: data.username,
      image: data.image,
      caption: data.caption || '',
      replyTo: data.replyTo || null,
      time: time,
      timestamp: Date.now()
    };
    
    messageHistory.push(messageData);
    if (messageHistory.length > 500) messageHistory.shift();
    
    io.emit('chat message', messageData);
  });
  
  socket.on('disconnect', () => {
    const username = connectedUsers.get(socket.id);
    if (username) {
      connectedUsers.delete(socket.id);
      userSockets.delete(username);
      
      const allUsers = Array.from(connectedUsers.values());
      io.emit('users list', allUsers);
      
      socket.broadcast.emit('user left', {
        username: username,
        time: new Date().toLocaleTimeString()
      });
      
      console.log(`❌ ${username} отключился. Онлайн: ${allUsers.length}`);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Мессенджер запущен на порту ${PORT}`);
  console.log(`🌐 Открой: http://localhost:${PORT}`);
});