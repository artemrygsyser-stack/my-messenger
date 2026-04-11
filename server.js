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

const connectedUsers = new Map(); // socket.id -> username
const messageHistory = [];
let activeCall = null; // { caller, callee, callerId, calleeId }

io.on('connection', (socket) => {
  console.log('Новое подключение:', socket.id);
  
  socket.emit('chat history', messageHistory.slice(-50));
  
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
  
  // ========== ГОЛОСОВОЙ ЧАТ ЧЕРЕЗ СЕРВЕР ==========
  
  // Начать звонок
  socket.on('start call', (data) => {
    const { targetUsername } = data;
    
    // Находим собеседника
    let targetId = null;
    let targetName = null;
    for (const [id, name] of connectedUsers.entries()) {
      if (name === targetUsername) {
        targetId = id;
        targetName = name;
        break;
      }
    }
    
    if (targetId && !activeCall) {
      activeCall = {
        caller: socket.username,
        callee: targetName,
        callerId: socket.id,
        calleeId: targetId
      };
      
      // Уведомляем собеседника
      io.to(targetId).emit('incoming call', {
        from: socket.username,
        fromId: socket.id
      });
      
      socket.emit('call status', { status: 'waiting', message: 'Звоним...' });
      console.log(`📞 ${socket.username} звонит ${targetName}`);
    } else if (activeCall) {
      socket.emit('call status', { status: 'busy', message: 'Кто-то уже разговаривает' });
    } else {
      socket.emit('call status', { status: 'offline', message: 'Пользователь не в сети' });
    }
  });
  
  // Принять звонок
  socket.on('accept call', () => {
    if (activeCall && activeCall.calleeId === socket.id) {
      // Уведомляем звонящего что можно говорить
      io.to(activeCall.callerId).emit('call accepted');
      socket.emit('call started');
      
      console.log(`✅ Звонок принят: ${activeCall.caller} <-> ${activeCall.callee}`);
    }
  });
  
  // Отклонить звонок
  socket.on('reject call', () => {
    if (activeCall && activeCall.calleeId === socket.id) {
      io.to(activeCall.callerId).emit('call rejected');
      activeCall = null;
      console.log(`❌ Звонок отклонён`);
    }
  });
  
  // Передача голосовых данных (реальное время)
  socket.on('voice data', (data) => {
    if (activeCall) {
      // Отправляем голос собеседнику
      if (socket.id === activeCall.callerId && activeCall.calleeId) {
        io.to(activeCall.calleeId).emit('voice data', data);
      } else if (socket.id === activeCall.calleeId && activeCall.callerId) {
        io.to(activeCall.callerId).emit('voice data', data);
      }
    }
  });
  
  // Завершить звонок
  socket.on('end call', () => {
    if (activeCall) {
      if (activeCall.callerId === socket.id) {
        io.to(activeCall.calleeId).emit('call ended');
      } else if (activeCall.calleeId === socket.id) {
        io.to(activeCall.callerId).emit('call ended');
      }
      activeCall = null;
      console.log(`🔴 Звонок завершён`);
    }
  });
  
  socket.on('disconnect', () => {
    const username = connectedUsers.get(socket.id);
    if (username) {
      // Если пользователь был в звонке - завершаем звонок
      if (activeCall && (activeCall.callerId === socket.id || activeCall.calleeId === socket.id)) {
        const otherId = activeCall.callerId === socket.id ? activeCall.calleeId : activeCall.callerId;
        io.to(otherId).emit('call ended');
        activeCall = null;
      }
      
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