export function renderDemoUi(input: {
  defaultAgentId: string;
  publicBaseUrl: string;
  leashRequired: boolean;
  signatureRequired: boolean;
}): string {
  const state = {
    defaultAgentId: input.defaultAgentId,
    publicBaseUrl: input.publicBaseUrl,
    leashRequired: input.leashRequired,
    signatureRequired: input.signatureRequired,
  };

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Kora Agent Rail</title>
    <style>
      :root {
        color-scheme: light;
        --ink: #172033;
        --muted: #607085;
        --line: #d9e1ea;
        --panel: #ffffff;
        --soft: #f6f8fb;
        --blue: #145ee6;
        --green: #087f5b;
        --amber: #9a5d00;
        --red: #b42318;
      }
      * {
        box-sizing: border-box;
      }
      body {
        margin: 0;
        background: var(--soft);
        color: var(--ink);
        font:
          14px/1.5 Inter,
          ui-sans-serif,
          system-ui,
          -apple-system,
          BlinkMacSystemFont,
          "Segoe UI",
          sans-serif;
      }
      main {
        min-height: 100vh;
        padding: 24px;
      }
      header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 16px;
        margin: 0 auto 18px;
        max-width: 1180px;
      }
      h1 {
        margin: 0;
        font-size: 24px;
        line-height: 1.2;
      }
      p {
        margin: 4px 0 0;
        color: var(--muted);
      }
      a {
        color: var(--blue);
      }
      .badge-row {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        justify-content: flex-end;
      }
      .badge {
        border: 1px solid var(--line);
        border-radius: 999px;
        background: var(--panel);
        color: var(--muted);
        padding: 4px 10px;
        white-space: nowrap;
      }
      .grid {
        display: grid;
        grid-template-columns: minmax(300px, 430px) minmax(420px, 1fr);
        gap: 16px;
        margin: 0 auto;
        max-width: 1180px;
      }
      section {
        background: var(--panel);
        border: 1px solid var(--line);
        border-radius: 8px;
        padding: 16px;
      }
      section + section {
        margin-top: 16px;
      }
      h2 {
        margin: 0 0 12px;
        font-size: 15px;
      }
      label {
        display: grid;
        gap: 5px;
        margin-bottom: 10px;
        color: var(--muted);
        font-size: 12px;
        font-weight: 600;
      }
      input,
      select {
        width: 100%;
        border: 1px solid var(--line);
        border-radius: 6px;
        background: #fff;
        color: var(--ink);
        font: inherit;
        padding: 9px 10px;
      }
      .row {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 10px;
      }
      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }
      button {
        border: 1px solid var(--blue);
        border-radius: 6px;
        background: var(--blue);
        color: #fff;
        cursor: pointer;
        font: inherit;
        font-weight: 700;
        padding: 9px 12px;
      }
      button.secondary {
        background: #fff;
        color: var(--blue);
      }
      button:disabled {
        cursor: wait;
        opacity: 0.6;
      }
      .status {
        border-radius: 6px;
        margin-top: 12px;
        padding: 10px;
      }
      .ok {
        background: #e8f7f1;
        color: var(--green);
      }
      .error {
        background: #fff0ee;
        color: var(--red);
      }
      .warn {
        background: #fff7e6;
        color: var(--amber);
      }
      pre {
        min-height: 430px;
        overflow: auto;
        border: 1px solid var(--line);
        border-radius: 8px;
        background: #111827;
        color: #e5edf7;
        margin: 0;
        padding: 14px;
        white-space: pre-wrap;
      }
      table {
        width: 100%;
        border-collapse: collapse;
        font-size: 13px;
      }
      th,
      td {
        border-bottom: 1px solid var(--line);
        padding: 8px 6px;
        text-align: left;
        vertical-align: top;
      }
      th {
        color: var(--muted);
        font-size: 12px;
      }
      code {
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      }
      @media (max-width: 900px) {
        main {
          padding: 16px;
        }
        header {
          display: block;
        }
        .badge-row {
          justify-content: flex-start;
          margin-top: 12px;
        }
        .grid,
        .row {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </head>
  <body>
    <main>
      <header>
        <div>
          <h1>Kora Agent Rail</h1>
          <p>Local-currency Kora services exposed as agent-callable tools.</p>
        </div>
        <div class="badge-row">
          <span class="badge">Agent <code>${escapeHtml(input.defaultAgentId)}</code></span>
          <span class="badge">Leash ${input.leashRequired ? 'on' : 'demo mode'}</span>
          <span class="badge">Signature ${input.signatureRequired ? 'required' : 'off'}</span>
        </div>
      </header>
      <div class="grid">
        <div>
          <section>
            <h2>Discovery</h2>
            <div class="actions">
              <button class="secondary" data-action="capabilities">Capabilities</button>
              <button class="secondary" data-action="balance">Balance</button>
              <button class="secondary" data-action="executions">Executions</button>
            </div>
            <p>
              <a href="/llms.txt">llms.txt</a> ·
              <a href="/openapi.json">OpenAPI</a> ·
              <a href="/.well-known/leash-mcp.json">MCP manifest</a>
            </p>
          </section>
          <section>
            <h2>Create Virtual Account</h2>
            <label>
              Account reference
              <input id="accountReference" />
            </label>
            <label>
              Account name
              <input id="accountName" value="Leash Demo Customer" />
            </label>
            <div class="row">
              <label>
                Bank code
                <input id="bankCode" value="000" />
              </label>
              <label>
                Currency
                <select id="currency">
                  <option>NGN</option>
                </select>
              </label>
            </div>
            <label>
              Customer name
              <input id="customerName" value="Leash Demo Customer" />
            </label>
            <label>
              Customer email
              <input id="customerEmail" value="demo@leash.market" />
            </label>
            <label>
              BVN
              <input id="bvn" value="22222222222" />
            </label>
            <button data-action="virtualAccount">Create virtual account</button>
            <div id="notice" class="status warn">Ready</div>
          </section>
        </div>
        <div>
          <section>
            <h2>Result</h2>
            <pre id="result">{}</pre>
          </section>
          <section>
            <h2>Recent Executions</h2>
            <table>
              <thead>
                <tr>
                  <th>Tool</th>
                  <th>Status</th>
                  <th>Reference</th>
                  <th>Receipt</th>
                </tr>
              </thead>
              <tbody id="executions"></tbody>
            </table>
          </section>
        </div>
      </div>
    </main>
    <script>
      const state = ${JSON.stringify(state)};
      const result = document.querySelector('#result');
      const notice = document.querySelector('#notice');
      const executions = document.querySelector('#executions');
      const accountReference = document.querySelector('#accountReference');

      accountReference.value = 'leash-demo-va-' + Date.now();

      function show(payload, tone = 'ok') {
        result.textContent = JSON.stringify(payload, null, 2);
        notice.className = 'status ' + tone;
        notice.textContent = payload.status || payload.message || tone;
      }

      async function post(path, body = {}) {
        const res = await fetch(path, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
        const payload = await res.json();
        show(payload, res.ok && payload.status !== 'error' ? 'ok' : 'error');
        await loadExecutions();
        return payload;
      }

      async function loadExecutions() {
        const res = await fetch('/kora-agents/' + state.defaultAgentId + '/executions');
        const payload = await res.json();
        executions.innerHTML = (payload.items || []).slice(0, 8).map((item) => {
          const hash = item.receiptHash ? item.receiptHash.slice(0, 12) + '...' : '';
          return '<tr><td><code>' + item.tool + '</code></td><td>' + item.status + '</td><td><code>' + (item.koraReference || '') + '</code></td><td><code>' + hash + '</code></td></tr>';
        }).join('');
      }

      document.querySelectorAll('[data-action]').forEach((button) => {
        button.addEventListener('click', async () => {
          button.disabled = true;
          try {
            if (button.dataset.action === 'capabilities') {
              await post('/tools/kora_get_agent_capabilities');
            }
            if (button.dataset.action === 'balance') {
              await post('/tools/kora_get_balance');
            }
            if (button.dataset.action === 'executions') {
              await loadExecutions();
              show({ status: 'ok', message: 'executions loaded' });
            }
            if (button.dataset.action === 'virtualAccount') {
              await post('/tools/kora_create_virtual_account', {
                account_name: document.querySelector('#accountName').value,
                account_reference: accountReference.value,
                permanent: true,
                bank_code: document.querySelector('#bankCode').value,
                currency: document.querySelector('#currency').value,
                customer: {
                  name: document.querySelector('#customerName').value,
                  email: document.querySelector('#customerEmail').value,
                },
                kyc: { bvn: document.querySelector('#bvn').value },
              });
              accountReference.value = 'leash-demo-va-' + Date.now();
            }
          } catch (err) {
            show({ status: 'error', message: err.message || 'request failed' }, 'error');
          } finally {
            button.disabled = false;
          }
        });
      });

      loadExecutions();
    </script>
  </body>
</html>`;
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
