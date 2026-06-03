(() => {
  const POLL_MS = 500;
  const MAX_POLLS = 60;
  let injected = false;

  function parseArgs(cmdText) {
    const args = [];
    if (cmdText.includes('--dry-run') || cmdText.includes('--no-post'))
      args.push('--dry-run');
    const dateMatch = cmdText.match(/--date[= ]+(\d{4}-\d{2}-\d{2})/);
    if (dateMatch) args.push(`--date=${dateMatch[1]}`);
    return args;
  }

  function createRunButton(pre) {
    const btn = document.createElement('button');
    btn.textContent = 'Run';
    btn.className = 'run-trigger';
    Object.assign(btn.style, {
      position: 'absolute', top: '8px', right: '60px',
      fontSize: '12px', padding: '2px 8px', borderRadius: '4px',
      background: '#238636', border: '1px solid #2ea043',
      color: '#fff', cursor: 'pointer', zIndex: '10',
      fontFamily: 'system-ui, sans-serif',
    });

    btn.addEventListener('mouseenter', () => { btn.style.background = '#2ea043'; });
    btn.addEventListener('mouseleave', () => { btn.style.background = '#238636'; });

    btn.addEventListener('click', async () => {
      btn.disabled = true;
      btn.textContent = 'Running…';
      btn.style.background = '#1f6feb';
      btn.style.borderColor = '#388bfd';

      const wrapper = pre.closest('.relative');
      let output = wrapper.querySelector('.run-output');
      if (!output) {
        output = document.createElement('pre');
        output.className = 'run-output';
        Object.assign(output.style, {
          margin: '0', padding: '12px 16px',
          fontSize: '12px', lineHeight: '1.6',
          color: '#e6edf3', background: '#0d1117',
          borderTop: '1px solid #30363d',
          fontFamily: 'JetBrains Mono, monospace',
          maxHeight: '300px', overflowY: 'auto',
          whiteSpace: 'pre-wrap', wordBreak: 'break-word',
        });
        wrapper.appendChild(output);
      }
      output.textContent = '';

      try {
        const cmdText = pre.textContent;
        const args = parseArgs(cmdText);
        const res = await fetch('/api/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ args }),
        });

        const reader = res.body.getReader();
        const decoder = new TextDecoder();

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          output.textContent += decoder.decode(value, { stream: true });
          output.scrollTop = output.scrollHeight;
        }
      } catch (err) {
        output.textContent += `\nError: ${err.message}\n`;
      }

      btn.disabled = false;
      btn.textContent = 'Run';
      btn.style.background = '#238636';
      btn.style.borderColor = '#2ea043';
    });

    return btn;
  }

  function inject() {
    if (injected) return;

    const blocks = document.querySelectorAll('pre');
    let count = 0;
    blocks.forEach(pre => {
      const text = pre.textContent || '';
      if (!text.includes('log-time.py')) return;

      const wrapper = pre.closest('.relative');
      if (!wrapper || wrapper.querySelector('.run-trigger')) return;

      wrapper.appendChild(createRunButton(pre));
      count++;
    });

    if (count > 0) injected = true;
  }

  let polls = 0;
  const timer = setInterval(() => {
    inject();
    polls++;
    if (injected || polls >= MAX_POLLS) clearInterval(timer);
  }, POLL_MS);

  const observer = new MutationObserver(() => inject());
  observer.observe(document.body, { childList: true, subtree: true });
})();
