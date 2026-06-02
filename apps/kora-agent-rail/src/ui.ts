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
        min-height: 40px;
        border: 1px solid var(--line);
        border-radius: 6px;
        background: #fff;
        color: var(--ink);
        font: inherit;
        padding: 9px 10px;
      }
      input:focus-visible,
      select:focus-visible,
      button:focus-visible,
      a:focus-visible {
        outline: 2px solid var(--blue);
        outline-offset: 2px;
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
        min-height: 40px;
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
      .subtle {
        color: var(--muted);
        font-size: 12px;
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
          <span class="badge">Default agent <code>${escapeHtml(input.defaultAgentId)}</code></span>
          <span class="badge">Leash ${input.leashRequired ? 'on' : 'demo mode'}</span>
          <span class="badge">Signature ${input.signatureRequired ? 'required' : 'off'}</span>
        </div>
      </header>
      <div class="grid">
        <div>
          <section>
            <h2>Merchant Kora Agent</h2>
            <label>
              Agent id
              <input id="agentId" autocomplete="off" spellcheck="false" />
            </label>
            <label>
              Agent name
              <input id="agentName" autocomplete="organization" value="Acme Finance Agent" />
            </label>
            <label>
              Description
              <input
                id="agentDescription"
                autocomplete="off"
                value="A Kora merchant agent that exposes approved local-currency services to AI agents."
              />
            </label>
            <div class="actions">
              <button class="secondary" data-action="useAgent">Use agent</button>
              <button data-action="createAgent">Create Kora Agent</button>
              <button class="secondary" data-action="publishAgent">Publish</button>
            </div>
            <div id="notice" class="status warn">Ready</div>
          </section>

          <section>
            <h2>Discovery</h2>
            <div class="row">
              <label>
                Country code
                <input id="countryCode" autocomplete="off" value="NG" maxlength="2" />
              </label>
              <label>
                Current agent
                <input id="currentAgent" readonly />
              </label>
            </div>
            <div class="actions">
              <button class="secondary" data-action="capabilities">Capabilities</button>
              <button class="secondary" data-action="balance">Balance</button>
              <button class="secondary" data-action="banks">List Banks</button>
              <button class="secondary" data-action="executions">Executions</button>
            </div>
            <p>
              <a href="/llms.txt">llms.txt</a> -
              <a href="/openapi.json">OpenAPI</a> -
              <a href="/.well-known/leash-mcp.json">MCP manifest</a>
            </p>
          </section>

          <section>
            <h2>Create Virtual Account</h2>
            <label>
              Account reference
              <input id="accountReference" autocomplete="off" spellcheck="false" />
            </label>
            <label>
              Account name
              <input id="accountName" autocomplete="name" value="Leash Demo Customer" />
            </label>
            <div class="row">
              <label>
                Bank code
                <input id="bankCode" autocomplete="off" value="000" />
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
              <input id="customerName" autocomplete="name" value="Leash Demo Customer" />
            </label>
            <label>
              Customer email
              <input id="customerEmail" type="email" autocomplete="email" value="demo@leash.market" />
            </label>
            <label>
              BVN
              <input id="bvn" autocomplete="off" inputmode="numeric" value="22222222222" />
            </label>
            <button data-action="virtualAccount">Create virtual account</button>
          </section>

          <section>
            <h2>Sandbox Payment</h2>
            <label>
              Virtual account number
              <input id="sandboxAccountNumber" autocomplete="off" inputmode="numeric" />
            </label>
            <div class="row">
              <label>
                Amount
                <input id="sandboxAmount" autocomplete="off" inputmode="decimal" value="1000" />
              </label>
              <label>
                Currency
                <select id="sandboxCurrency">
                  <option>NGN</option>
                </select>
              </label>
            </div>
            <button data-action="sandboxCredit">Credit sandbox virtual account</button>
            <p class="subtle">
              This simulates a local-currency payment into the test virtual account.
            </p>
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
                  <th>Amount</th>
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
      state.currentAgentId = state.defaultAgentId;

      const result = document.querySelector('#result');
      const notice = document.querySelector('#notice');
      const executions = document.querySelector('#executions');
      const accountReference = document.querySelector('#accountReference');
      const agentIdInput = document.querySelector('#agentId');
      const currentAgent = document.querySelector('#currentAgent');
      const sandboxAccountNumber = document.querySelector('#sandboxAccountNumber');

      accountReference.value = 'leash-demo-va-' + Date.now();
      agentIdInput.value = state.defaultAgentId;
      updateCurrentAgent();

      function currentAgentId() {
        return agentIdInput.value.trim() || state.defaultAgentId;
      }

      function updateCurrentAgent() {
        state.currentAgentId = currentAgentId();
        currentAgent.value = state.currentAgentId;
      }

      function escapeValue(value) {
        return String(value ?? '').replace(/[&<>"']/g, (char) => ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#39;',
        }[char]));
      }

      function findValue(payload, keys) {
        if (!payload || typeof payload !== 'object') return '';
        for (const key of keys) {
          if (typeof payload[key] === 'string') return payload[key];
        }
        for (const value of Object.values(payload)) {
          const found = findValue(value, keys);
          if (found) return found;
        }
        return '';
      }

      function setNotice(message, tone = 'ok') {
        notice.className = 'status ' + tone;
        notice.textContent = message;
      }

      function show(payload, tone = 'ok') {
        result.textContent = JSON.stringify(payload, null, 2);
        setNotice(payload.status || payload.message || tone, tone);
      }

      async function requestJson(path, options = {}) {
        const res = await fetch(path, options);
        const text = await res.text();
        const payload = text ? JSON.parse(text) : {};
        if (!res.ok) {
          show(payload, 'error');
        }
        return { res, payload };
      }

      async function postTool(tool, body = {}) {
        updateCurrentAgent();
        const { res, payload } = await requestJson('/tools/' + tool, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ agent_id: state.currentAgentId, ...body }),
        });
        show(payload, res.ok && payload.status !== 'error' ? 'ok' : 'error');
        await loadExecutions();
        return payload;
      }

      async function loadExecutions() {
        updateCurrentAgent();
        const { payload } = await requestJson(
          '/kora-agents/' + encodeURIComponent(state.currentAgentId) + '/executions',
        );
        executions.innerHTML = (payload.items || []).slice(0, 8).map((item) => {
          const hash = item.receiptHash ? item.receiptHash.slice(0, 12) + '...' : '';
          const amount = item.amount == null ? '' : item.amount + ' ' + (item.currency || '');
          return '<tr><td><code>' + escapeValue(item.tool) + '</code></td><td>' +
            escapeValue(item.status) + '</td><td>' + escapeValue(amount) +
            '</td><td><code>' + escapeValue(item.koraReference) +
            '</code></td><td><code>' + escapeValue(hash) + '</code></td></tr>';
        }).join('');
      }

      async function createAgent() {
        updateCurrentAgent();
        const name = document.querySelector('#agentName').value.trim() || state.currentAgentId;
        const description = document.querySelector('#agentDescription').value.trim();
        const { res, payload } = await requestJson('/kora-agents', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            id: state.currentAgentId,
            name,
            description,
          }),
        });
        if (payload.id) {
          agentIdInput.value = payload.id;
          updateCurrentAgent();
        }
        show(payload, res.ok ? 'ok' : 'error');
        await loadExecutions();
      }

      async function publishAgent() {
        updateCurrentAgent();
        const { res, payload } = await requestJson(
          '/kora-agents/' + encodeURIComponent(state.currentAgentId) + '/publish',
          { method: 'POST' },
        );
        show(payload, res.ok ? 'ok' : 'error');
      }

      document.querySelectorAll('[data-action]').forEach((button) => {
        button.addEventListener('click', async () => {
          button.disabled = true;
          try {
            if (button.dataset.action === 'useAgent') {
              updateCurrentAgent();
              show({ status: 'ok', agent_id: state.currentAgentId, message: 'agent selected' });
              await loadExecutions();
            }
            if (button.dataset.action === 'createAgent') {
              await createAgent();
            }
            if (button.dataset.action === 'publishAgent') {
              await publishAgent();
            }
            if (button.dataset.action === 'capabilities') {
              await postTool('kora_get_agent_capabilities');
            }
            if (button.dataset.action === 'balance') {
              await postTool('kora_get_balance');
            }
            if (button.dataset.action === 'banks') {
              await postTool('kora_list_banks', {
                country_code: document.querySelector('#countryCode').value.trim().toUpperCase() || 'NG',
              });
            }
            if (button.dataset.action === 'executions') {
              await loadExecutions();
              show({ status: 'ok', agent_id: state.currentAgentId, message: 'executions loaded' });
            }
            if (button.dataset.action === 'virtualAccount') {
              const payload = await postTool('kora_create_virtual_account', {
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
              const accountNumber = findValue(payload, ['account_number', 'accountNumber']);
              if (accountNumber) sandboxAccountNumber.value = accountNumber;
              accountReference.value = 'leash-demo-va-' + Date.now();
            }
            if (button.dataset.action === 'sandboxCredit') {
              await postTool('kora_credit_sandbox_virtual_account', {
                account_number: sandboxAccountNumber.value.trim(),
                amount: document.querySelector('#sandboxAmount').value.trim(),
                currency: document.querySelector('#sandboxCurrency').value,
              });
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
