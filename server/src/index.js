import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import cors from 'cors';
import { setupWebSocket } from './services/websocket.js';
import { apiRouter } from './routes/api.js';

const app = express();
const server = createServer(app);

app.use(cors());
app.use(express.json());
app.use('/api', apiRouter);

// Serve static files in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static('../client/dist'));
}

setupWebSocket(server);

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
