/* The two public pages the sync server serves for pairing phones.

   /.well-known/assetlinks.json tells Android that links to /link on this
   server belong to the WhenDose app (App Links), so a phone's camera opens a
   pairing QR code straight in the app.

   /link is what a phone sees if it opens the pairing link in a browser
   instead. The family id and key are after the # in the link, which the
   browser never sends here; this page only offers to open WhenDose with
   them, or to copy them. It loads nothing else. */

export const PACKAGE = 'nz.whendose.app';

/** @param {string[]} fingerprints  SHA-256 of the app's signing certificate(s), AA:BB:… */
export function assetLinks(fingerprints) {
  return [{
    relation: ['delegate_permission/common.handle_all_urls'],
    target: { namespace: 'android_app', package_name: PACKAGE, sha256_cert_fingerprints: fingerprints },
  }];
}

export const LINK_PAGE = `<!doctype html>
<html lang="en-NZ">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>Link with WhenDose</title>
<style>
  body { margin: 0; font: 18px/1.5 system-ui, sans-serif; background: #edf1ff; color: #232a5c; }
  main { max-width: 480px; margin: 0 auto; padding: 32px 20px; display: grid; gap: 16px; }
  h1 { font-size: 1.6rem; margin: 0; }
  a.btn, button { display: block; text-align: center; min-height: 56px; padding: 14px 20px; border-radius: 999px; font: inherit; font-weight: 700; text-decoration: none; }
  a.btn { background: #a9b8ff; color: #171c5a; }
  button { background: #fff; color: #232a5c; border: 2px solid #d7dcf7; }
  p.small { font-size: 0.95rem; color: #545c8c; }
</style>
</head>
<body>
<main>
  <h1>Link with WhenDose</h1>
  <p>This link joins a phone to your family's WhenDose, so both phones share one record.</p>
  <a class="btn" id="open" href="#">Open in WhenDose</a>
  <button id="copy" type="button">Copy the code</button>
  <p class="small" id="note">If the app does not open: in WhenDose, go to Settings, Linked phones, and paste the code.</p>
  <p class="small">Only use a link your partner's phone showed you. The code is the key to your records; it stays on your phones and is never sent to this server.</p>
</main>
<script>
  var code = location.hash.slice(1);
  if (!/^1:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]{43}$/.test(code)) {
    document.getElementById('open').remove();
    document.getElementById('copy').remove();
    document.getElementById('note').textContent = 'This link is not complete. Show the code again on the first phone.';
  } else {
    document.getElementById('open').href = 'whendose://link#' + code;
    document.getElementById('copy').onclick = function () {
      navigator.clipboard.writeText(location.origin + '/link#' + code).then(function () { document.getElementById('copy').textContent = 'Copied'; });
    };
  }
</script>
</body>
</html>`;
