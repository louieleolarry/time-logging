import { Router } from 'express';
import https from 'https';
import os from 'os';
import path from 'path';
import fs from 'fs';

const router = Router();

function jiraRequest(jiraUrl, email, token, apiPath) {
  return new Promise((resolve, reject) => {
    const url = new URL(apiPath, jiraUrl);
    const auth = Buffer.from(`${email}:${token}`).toString('base64');

    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'GET',
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(8000, () => { req.destroy(); reject(new Error('Request timed out')); });
    req.end();
  });
}

// POST /api/verify
// Body: { jiraUrl, email, token } — or reads from config if omitted
router.post('/', async (req, res) => {
  let { jiraUrl, email, token } = req.body;

  // Fall back to saved config
  if (!jiraUrl || !email || !token) {
    try {
      const config = JSON.parse(
        fs.readFileSync(path.join(os.homedir(), '.jira-time-tracker', 'config.json'), 'utf8')
      );
      jiraUrl = jiraUrl || config.jira?.url;
      email = email || config.jira?.email;
      token = token || config.jira?.token;
    } catch {}
  }

  if (!jiraUrl || !email || !token) {
    return res.status(400).json({ ok: false, error: 'Missing Jira credentials' });
  }

  try {
    const result = await jiraRequest(jiraUrl, email, token, '/rest/api/3/myself');

    if (result.status === 200) {
      res.json({
        ok: true,
        account: {
          displayName: result.body.displayName,
          email: result.body.emailAddress,
          accountId: result.body.accountId,
          avatarUrl: result.body.avatarUrls?.['48x48'],
        },
      });
    } else if (result.status === 401) {
      res.status(401).json({ ok: false, error: 'Invalid credentials — check your API token.' });
    } else {
      res.status(result.status).json({ ok: false, error: `Jira returned HTTP ${result.status}` });
    }
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
