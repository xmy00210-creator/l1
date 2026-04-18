const express = require('express');
const WebSocket = require('ws');
const http = require('http');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = 3000;

// 中间件
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// 初始化数据库
const db = new sqlite3.Database('./database.sqlite');

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        content TEXT,
        assignee TEXT,
        priority TEXT,
        status TEXT,
        tags TEXT,
        createdAt TEXT,
        completedAt TEXT,
        roomId TEXT
    )`);
});

// 房间管理
const rooms = new Map();

function broadcastToRoom(roomId, message) {
    const clients = rooms.get(roomId);
    if (!clients) return;
    clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(message));
        }
    });
}

// WebSocket
wss.on('connection', (ws, req) => {
    const url = new URL(req.url, 'http://localhost');
    const roomId = url.searchParams.get('room') || 'default';
    ws.roomId = roomId;
    
    if (!rooms.has(roomId)) rooms.set(roomId, new Set());
    rooms.get(roomId).add(ws);
    
    console.log(`用户加入房间: ${roomId}`);
    
    // 发送历史数据
    db.all('SELECT * FROM tasks WHERE roomId = ?', [roomId], (err, rows) => {
        if (err) return;
        const tasks = rows.map(row => ({
            ...row,
            tags: JSON.parse(row.tags || '[]')
        }));
        ws.send(JSON.stringify({ type: 'init', tasks }));
    });
    
    ws.on('message', (data) => {
        try {
            const msg = JSON.parse(data);
            msg.roomId = roomId;
            
            switch (msg.type) {
                case 'add':
                    const task = {
                        id: Date.now().toString(),
                        title: msg.task.title,
                        content: msg.task.content || '',
                        assignee: msg.task.assignee || 'A',
                        priority: msg.task.priority || 'low',
                        status: msg.task.status || 'todo',
                        tags: JSON.stringify(msg.task.tags || ['任务']),
                        createdAt: new Date().toISOString(),
                        completedAt: null,
                        roomId
                    };
                    db.run(`INSERT INTO tasks VALUES (?,?,?,?,?,?,?,?,?,?)`,
                        [task.id, task.title, task.content, task.assignee, task.priority, 
                         task.status, task.tags, task.createdAt, task.completedAt, task.roomId],
                        () => broadcastToRoom(roomId, { type: 'add', task: {...task, tags: JSON.parse(task.tags)} })
                    );
                    break;
                    
                case 'move':
                    const completedAt = msg.status === 'done' ? new Date().toISOString() : null;
                    db.run('UPDATE tasks SET status = ?, completedAt = ? WHERE id = ? AND roomId = ?',
                        [msg.status, completedAt, msg.taskId, roomId],
                        () => broadcastToRoom(roomId, { type: 'move', taskId: msg.taskId, status: msg.status, completedAt })
                    );
                    break;
                    
                case 'delete':
                    db.run('DELETE FROM tasks WHERE id = ? AND roomId = ?', [msg.taskId, roomId],
                        () => broadcastToRoom(roomId, { type: 'delete', taskId: msg.taskId })
                    );
                    break;
            }
        } catch (err) {
            console.error(err);
        }
    });
    
    ws.on('close', () => {
        const clients = rooms.get(roomId);
        if (clients) {
            clients.delete(ws);
            if (clients.size === 0) rooms.delete(roomId);
        }
    });
});

// HTTP API
app.get('/api/room/:roomId/export', (req, res) => {
    const { roomId } = req.params;
    db.all('SELECT * FROM tasks WHERE roomId = ?', [roomId], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        const tasks = rows.map(row => ({...row, tags: JSON.parse(row.tags || '[]')}));
        res.json({ roomId, tasks, exportTime: new Date().toISOString() });
    });
});

server.listen(PORT, () => {
    console.log(`========================================`);
    console.log(`TeamFlow 服务器已启动`);
    console.log(`访问地址: http://localhost:${PORT}`);
    console.log(`========================================`);
});