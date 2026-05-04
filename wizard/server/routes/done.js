import { Router } from 'express';

const router = Router();

// POST /api/done — gracefully shut down the wizard server
router.post('/', (_req, res) => {
  res.json({ ok: true, message: 'Setup complete. You can close this window.' });
  // Give the response time to send before shutting down
  setTimeout(() => {
    if (process.send) {
      process.send('shutdown');
    } else {
      process.exit(0);
    }
  }, 500);
});

export default router;
