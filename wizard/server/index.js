import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

import checkRouter from './routes/check.js';
import installRouter from './routes/install.js';
import configRouter from './routes/config.js';
import launchdRouter from './routes/launchd.js';
import verifyRouter from './routes/verify.js';
import doneRouter from './routes/done.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const server = createServer(app);

app.use(cors());
app.use(express.json());

// API routes
app.use('/api/check', checkRouter);
app.use('/api/install', installRouter);
app.use('/api/config', configRouter);
app.use('/api/launchd', launchdRouter);
app.use('/api/verify', verifyRouter);
app.use('/api/done', doneRouter);

// Serve built React UI
const uiPath = path.resolve(__dirname, '..', 'client', 'dist');
if (fs.existsSync(uiPath)) {
  app.use(express.static(uiPath));
  app.get('*', (_req, res) => res.sendFile(path.join(uiPath, 'index.html')));
} else {
  app.get('/', (_req, res) => res.send('<h2>UI not built yet — run: cd client && pnpm build</h2>'));
}

const PORT = parseInt(process.env.WIZARD_PORT || '7429', 10);
server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n✅ Jira Time Tracker Wizard running at http://localhost:${PORT}\n`);
  // Signal setup.sh that server is ready
  if (process.send) process.send('ready');
});

// Graceful shutdown signal from /api/done
process.on('message', (msg) => {
  if (msg === 'shutdown') {
    console.log('\n✅ Setup complete. Shutting down wizard server.\n');
    server.close(() => process.exit(0));
  }
});
