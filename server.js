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

const connectedUsers = new Map(); // socket.id -> { username, socketId }
const messageHistory = [];
const usersInfo = new Map(); // username -> socket.id

// Храним активные звонки
const activeCalls = new Map(); // callerId -> { targetId, callerName, targetName }

io.on('connection', (socket) => {
  console.log('Новое подключение:', socket.id);
  
  // Отправляем историю
  socket.emit('chat history', messageHistory.slice(-50));
  
  // Пользователь присоединился
  socket.on('user join', (username) => {
    if (!username || username.trim() === '') return;
    
    username = username.trim();
    connectedUsers.set(socket.id, { username, socketId: socket.id });
    usersInfo.set(username, socket.id);
    
    // Отправляем текущему пользователю список всех
    const allUsers = Array.from(connectedUsers.values()).map(u => u.username);
    io.emit('users list', allUsers);
    
    // Уведомляем всех о новом
    socket.broadcast.emit('user joined', {
      username: username,
      time: new Date().toLocaleTimeString()
    });
    
    console.log(`✅ ${username} присоединился`);
  });
  
  // Обычное сообщение
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
  
  // Инициация звонка
  socket.on('call user', (data) => {
    const { targetUsername, callerUsername, offer } = data;
    
    const targetSocketId = usersInfo.get(targetUsername);
    const callerSocketId = socket.id;
    
    if (targetSocketId) {
      // Сохраняем информацию о звонке
      activeCalls.set(callerSocketId, {
        targetId: targetSocketId,
        targetName: targetUsername,
        callerName: callerUsername
      });
      
      // Отправляем запрос на звонок
      io.to(targetSocketId).emit('incoming call', {
        from: callerUsername,
        fromId: callerSocketId,
        offer: offer
      });
      
      console.log(`📞 ${callerUsername} звонит ${targetUsername}`);
    } else {
      socket.emit('call error', 'Пользователь не в сети');
    }
  });
  
  // Ответ на звонок
  socket.on('answer call', (data) => {
    const { toId, answer } = data;
    io.to(toId).emit('call answered', { answer: answer });
  });
  
  // ICE кандидаты (для соединения)
  socket.on('ice candidate', (data) => {
    const { toId, candidate } = data;
    io.to(toId).emit('ice candidate', { candidate: candidate, fromId: socket.id });
  });
  
  // Завершение звонка
  socket.on('end call', (data) => {
    const { toId } = data;
    io.to(toId).emit('call ended');
    
    // Удаляем из активных звонков
    activeCalls.delete(socket.id);
    activeCalls.delete(toId);
  });
  
  // Отклонение звонка
  socket.on('reject call', (data) => {
    const { toId } = data;
    io.to(toId).emit('call rejected');
    activeCalls.delete(toId);
  });
  
  // Пользователь отключился
  socket.on('disconnect', () => {
    const user = connectedUsers.get(socket.id);
    if (user) {
      const username = user.username;
      connectedUsers.delete(socket.id);
      usersInfo.delete(username);
      
      const allUsers = Array.from(connectedUsers.values()).map(u => u.username);
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