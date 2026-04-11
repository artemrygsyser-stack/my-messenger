const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const fs = require('fs');

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

// Файлы для сохранения истории
const HISTORY_FILE = './chat_history.json';
const PRIVATE_HISTORY_FILE = './private_history.json';

let messageHistory = [];
let privateMessages = {}; // { "user1_user2": [messages] }
let messageId = 0;
let privateMessageId = 0;

// Загрузка истории при запуске
if (fs.existsSync(HISTORY_FILE)) {
  try {
    const data = fs.readFileSync(HISTORY_FILE, 'utf8');
    messageHistory = JSON.parse(data);
    if (messageHistory.length > 0) {
      messageId = Math.max(...messageHistory.map(m => m.id)) + 1;
    }
    console.log(`✅ Загружено ${messageHistory.length} общих сообщений`);
  } catch(e) { console.log('Ошибка загрузки истории'); }
}

if (fs.existsSync(PRIVATE_HISTORY_FILE)) {
  try {
    const data = fs.readFileSync(PRIVATE_HISTORY_FILE, 'utf8');
    privateMessages = JSON.parse(data);
    console.log(`✅ Загружены личные сообщения`);
  } catch(e) { console.log('Ошибка загрузки личных сообщений'); }
}

// Сохранение истории
function saveHistory() {
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(messageHistory.slice(-500), null, 2));
}

function savePrivateHistory() {
  fs.writeFileSync(PRIVATE_HISTORY_FILE, JSON.stringify(privateMessages, null, 2));
}

const connectedUsers = new Map();
const userSockets = new Map();

io.on('connection', (socket) => {
  console.log('Новое подключение:', socket.id);
  
  socket.emit('chat history', messageHistory.slice(-100));
  
  socket.on('user join', (username) => {
    if (!username || username.trim() === '') return;
    
    username = username.trim();
    
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
  
  // Получение личных сообщений с пользователем
  socket.on('get private messages', (targetUser) => {
    const key = [socket.username, targetUser].sort().join('_');
    const messages = privateMessages[key] || [];
    socket.emit('private history', messages);
  });
  
  // Общее сообщение
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
    saveHistory();
    
    io.emit('chat message', messageData);
  });
  
  // Личное сообщение
  socket.on('private message', (data) => {
    if (!data.from || !data.to || !data.message) return;
    
    privateMessageId++;
    const time = new Date().toLocaleTimeString();
    const messageData = {
      id: privateMessageId,
      type: 'text',
      from: data.from,
      to: data.to,
      message: data.message,
      time: time,
      timestamp: Date.now()
    };
    
    const key = [data.from, data.to].sort().join('_');
    if (!privateMessages[key]) privateMessages[key] = [];
    privateMessages[key].push(messageData);
    if (privateMessages[key].length > 200) privateMessages[key].shift();
    savePrivateHistory();
    
    // Отправляем получателю, если он онлайн
    const targetSocketId = userSockets.get(data.to);
    if (targetSocketId) {
      io.to(targetSocketId).emit('private message', messageData);
    }
    
    // Отправляем отправителю подтверждение
    socket.emit('private message sent', messageData);
  });
  
  // Редактирование общего сообщения
  socket.on('edit message', (data) => {
    const { messageId: editId, newMessage } = data;
    const msgIndex = messageHistory.findIndex(m => m.id === editId);
    
    if (msgIndex !== -1 && messageHistory[msgIndex].username === socket.username) {
      messageHistory[msgIndex].message = newMessage;
      messageHistory[msgIndex].edited = true;
      messageHistory[msgIndex].editedAt = new Date().toLocaleTimeString();
      saveHistory();
      io.emit('message edited', {
        id: editId,
        message: newMessage,
        editedAt: messageHistory[msgIndex].editedAt
      });
    }
  });
  
  // Редактирование личного сообщения
  socket.on('edit private message', (data) => {
    const { messageId: editId, newMessage, targetUser } = data;
    const key = [socket.username, targetUser].sort().join('_');
    const msgIndex = privateMessages[key]?.findIndex(m => m.id === editId);
    
    if (msgIndex !== -1 && privateMessages[key][msgIndex].from === socket.username) {
      privateMessages[key][msgIndex].message = newMessage;
      privateMessages[key][msgIndex].edited = true;
      privateMessages[key][msgIndex].editedAt = new Date().toLocaleTimeString();
      savePrivateHistory();
      
      const targetSocketId = userSockets.get(targetUser);
      if (targetSocketId) {
        io.to(targetSocketId).emit('private message edited', {
          id: editId,
          message: newMessage,
          editedAt: privateMessages[key][msgIndex].editedAt
        });
      }
      socket.emit('private message edited', {
        id: editId,
        message: newMessage,
        editedAt: privateMessages[key][msgIndex].editedAt
      });
    }
  });
  
  // Удаление общего сообщения
  socket.on('delete message', (data) => {
    const { messageId: deleteId } = data;
    const msgIndex = messageHistory.findIndex(m => m.id === deleteId);
    
    if (msgIndex !== -1 && messageHistory[msgIndex].username === socket.username) {
      messageHistory[msgIndex].deleted = true;
      messageHistory[msgIndex].message = 'Сообщение удалено';
      saveHistory();
      io.emit('message deleted', { id: deleteId });
    }
  });
  
  // Удаление личного сообщения
  socket.on('delete private message', (data) => {
    const { messageId: deleteId, targetUser } = data;
    const key = [socket.username, targetUser].sort().join('_');
    const msgIndex = privateMessages[key]?.findIndex(m => m.id === deleteId);
    
    if (msgIndex !== -1 && privateMessages[key][msgIndex].from === socket.username) {
      privateMessages[key][msgIndex].deleted = true;
      privateMessages[key][msgIndex].message = 'Сообщение удалено';
      savePrivateHistory();
      
      const targetSocketId = userSockets.get(targetUser);
      if (targetSocketId) {
        io.to(targetSocketId).emit('private message deleted', { id: deleteId });
      }
      socket.emit('private message deleted', { id: deleteId });
    }
  });
  
  // Голосовое сообщение (общее)
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
    saveHistory();
    
    io.emit('chat message', messageData);
  });
  
  // Личное голосовое сообщение
  socket.on('private voice message', (data) => {
    if (!data.from || !data.to || !data.audio) return;
    
    privateMessageId++;
    const time = new Date().toLocaleTimeString();
    const messageData = {
      id: privateMessageId,
      type: 'voice',
      from: data.from,
      to: data.to,
      audio: data.audio,
      duration: data.duration,
      time: time,
      timestamp: Date.now()
    };
    
    const key = [data.from, data.to].sort().join('_');
    if (!privateMessages[key]) privateMessages[key] = [];
    privateMessages[key].push(messageData);
    if (privateMessages[key].length > 200) privateMessages[key].shift();
    savePrivateHistory();
    
    const targetSocketId = userSockets.get(data.to);
    if (targetSocketId) {
      io.to(targetSocketId).emit('private voice message', messageData);
    }
    socket.emit('private voice message sent', messageData);
  });
  
  // Фото сообщение (общее)
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
    saveHistory();
    
    io.emit('chat message', messageData);
  });
  
  // Личное фото сообщение
  socket.on('private image message', (data) => {
    if (!data.from || !data.to || !data.image) return;
    
    privateMessageId++;
    const time = new Date().toLocaleTimeString();
    const messageData = {
      id: privateMessageId,
      type: 'image',
      from: data.from,
      to: data.to,
      image: data.image,
      caption: data.caption || '',
      time: time,
      timestamp: Date.now()
    };
    
    const key = [data.from, data.to].sort().join('_');
    if (!privateMessages[key]) privateMessages[key] = [];
    privateMessages[key].push(messageData);
    if (privateMessages[key].length > 200) privateMessages[key].shift();
    savePrivateHistory();
    
    const targetSocketId = userSockets.get(data.to);
    if (targetSocketId) {
      io.to(targetSocketId).emit('private image message', messageData);
    }
    socket.emit('private image message sent', messageData);
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