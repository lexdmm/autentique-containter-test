import type { Signature, StoredDocument } from '../types';

function escapeHtml(value: unknown): string {
    const entities: Record<string, string> = {
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    };

    return String(value ?? '').replace(/[&<>"']/g, (char) => entities[char] ?? char);
}

function renderSignPage(document: StoredDocument, signer: Signature): string {
    const label = escapeHtml(signer.name || signer.email || signer.phone);
    const alreadySigned = Boolean(signer.signed_at);

    return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Simular assinatura - ${escapeHtml(document.name)}</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 480px; margin: 60px auto; padding: 0 20px; color: #222; }
  .badge { display: inline-block; background: #b91c1c; color: #fff; font-size: 12px; padding: 4px 8px; border-radius: 4px; margin-bottom: 16px; }
  input, button { font-size: 16px; padding: 10px; width: 100%; box-sizing: border-box; margin-top: 8px; }
  button { background: #111; color: #fff; border: none; cursor: pointer; }
  button:disabled { background: #999; }
  pre { background: #f4f4f4; padding: 12px; overflow-x: auto; font-size: 13px; }
  .signed { color: #15803d; font-weight: bold; }
</style>
</head>
<body>
  <div class="badge">SIMULATED - not a real Autentique page</div>
  <h1>${escapeHtml(document.name)}</h1>
  <p>Signer: <strong>${label}</strong></p>
  ${alreadySigned && document.signed ? `
    <p class="signed">This document is already signed.</p>
    <p><a href="/files/${escapeHtml(document.id)}/signed.pdf">Download signed PDF</a></p>
  ` : alreadySigned ? `
    <p class="signed">Your signature was recorded. The final PDF will be available after every signer finishes.</p>
  ` : `
    <label for="cpf">Signer's CPF (must match a real record in the app you're testing, digits only)</label>
    <input id="cpf" inputmode="numeric" maxlength="11" pattern="[0-9]{11}" placeholder="12345678901" />
    <button id="submit">Simulate signature</button>
  `}
  <pre id="result" hidden></pre>
<script>
  const button = document.getElementById('submit');
  if (button) {
    button.addEventListener('click', async () => {
      button.disabled = true;
      const cpf = document.getElementById('cpf').value.trim();
      const result = document.getElementById('result');
      result.hidden = false;
      result.textContent = 'Signing...';
      try {
        const response = await fetch('/simulate/${escapeHtml(signer.public_id)}/sign', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cpf }),
        });
        result.textContent = JSON.stringify(await response.json(), null, 2);
      } catch (error) {
        result.textContent = 'Failed: ' + error.message;
      }
      button.disabled = false;
    });
  }
</script>
</body>
</html>`;
}

export { renderSignPage };
