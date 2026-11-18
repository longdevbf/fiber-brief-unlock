'use client';

import { channelFundingGuidance } from '../lib/channel-funding';
import { useEffect, useRef, useState } from 'react';
import { scriptToAddress, type Channel, type FiberBrowserNode, type GetPaymentResult } from '@fiber-pay/sdk/browser';
import { base64ToBytes, bytesToBase64, decryptBundle, sha256Hex, toHex, type Bundle } from '../lib/crypto';
import { bottle, channelFundingCkb, connectAndOpenChannel, readChannel, ready, startRole } from '../lib/fiber';
import { createOffer, parseOffer, type EncryptedOffer } from '../lib/offer';
import { payForOffer, validateOffer } from '../lib/payment';
import { createBrowserNodeSession } from '../lib/node-session';
import { readOnchainShannons } from '../lib/balance';
import { countWords, listingAad, maxAttachmentBytes, maxPreviewLength, maxTitleLength, priceOptions, priceShannons, type Listing } from '../lib/listing';
import { sampleBody, samplePreview, sampleTitle } from '../lib/sample';
import { encryptedSessionKey, encryptedBuyerProfile, encryptedSellerProfile, savedNodeIdentifier, readEncryptedProgress, type EncryptedLessonProgress } from '../lib/progress';

type Role = 'buyer' | 'seller';
const ckb = (value: string | bigint) => `${Number(BigInt(value)) / 100_000_000}`;
const short = (value: string, head = 10, tail = 8) => (value.length > head + tail + 1 ? `${value.slice(0, head)}…${value.slice(-tail)}` : value);
const kb = (bytes: number) => `${(bytes / 1024).toFixed(bytes < 10_240 ? 1 : 0)} KB`;
const roleName: Record<Role, string> = { buyer: 'Buyer A · reader', seller: 'Seller C · author' };

function Lock() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>;
}

function Bar({ left, right, leftLabel }: { left: string; right: string; leftLabel: string }) {
  const l = Number(BigInt(left)), r = Number(BigInt(right));
  const pct = l + r > 0 ? (l / (l + r)) * 100 : 0;
  return <div className="bar">
    <div className="bar-labels"><span>{leftLabel} <b>{ckb(left)} CKB</b></span><span>Bottle B <b>{ckb(right)} CKB</b></span></div>
    <div className="track"><i style={{ width: `${pct}%` }} /></div>
  </div>;
}

export default function Page() {
  const nodes = useRef<Partial<Record<Role, FiberBrowserNode>>>({});
  const sessions = useRef<Partial<Record<Role, ReturnType<typeof createBrowserNodeSession>>>>({});
  const progress = useRef<EncryptedLessonProgress | null>(null);
  const locked = useRef(false);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [addresses, setAddresses] = useState<Partial<Record<Role, string>>>({});
  const [onchain, setOnchain] = useState<Partial<Record<Role, bigint>>>({});
  const [connected, setConnected] = useState<Partial<Record<Role, boolean>>>({});
  const [channels, setChannels] = useState<Partial<Record<Role, Channel>>>({});
  // Seller form
  const [title, setTitle] = useState(sampleTitle);
  const [preview, setPreview] = useState(samplePreview);
  const [price, setPrice] = useState<number>(priceOptions[0]);
  const [body, setBody] = useState(sampleBody);
  const [file, setFile] = useState<File | null>(null);
  const [generated, setGenerated] = useState('');
  // Buyer side
  const [received, setReceived] = useState('');
  const [offer, setOffer] = useState<EncryptedOffer | null>(null);
  const [attempt, setAttempt] = useState('');
  const [tested, setTested] = useState(false);
  const [payment, setPayment] = useState<GetPaymentResult | null>(null);
  const [key, setKey] = useState('');
  const [keyMatches, setKeyMatches] = useState<boolean | null>(null);
  const [unlocked, setUnlocked] = useState<Bundle | null>(null);
  const [fileUrl, setFileUrl] = useState('');
  const [tamper, setTamper] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    const saved = readEncryptedProgress(sessionStorage, localStorage);
    progress.current = saved;
    if (saved) { setGenerated(saved.generatedOffer); setReceived(saved.buyerOfferText); setAttempt(saved.attemptedPaymentHash); setTested(saved.triedWithoutKey); }
    setLoaded(true);
    const owned = sessions.current;
    const stop = () => { for (const session of Object.values(owned)) void session.stop().catch(() => {}); };
    window.addEventListener('pagehide', stop);
    return () => { window.removeEventListener('pagehide', stop); stop(); nodes.current = {}; sessions.current = {}; };
  }, []);

  useEffect(() => () => { if (fileUrl) URL.revokeObjectURL(fileUrl); }, [fileUrl]);

  // While a channel is opening or its Bottle connection is not up yet, check every 5 seconds (only while the tab is visible).
  useEffect(() => {
    const opening = (['buyer', 'seller'] as const).filter((role) => nodes.current[role] && channels[role] && (!ready(channels[role]!) || !connected[role]));
    if (!opening.length) return;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') for (const role of opening) void refresh(role).catch(() => {});
    }, 5_000);
    return () => clearInterval(timer);
  }, [channels, connected]);

  function save(update: Partial<EncryptedLessonProgress>) {
    const buyerId = savedNodeIdentifier(localStorage, encryptedBuyerProfile);
    const sellerId = savedNodeIdentifier(localStorage, encryptedSellerProfile);
    if (!buyerId || !sellerId) throw new Error('Start both saved nodes before continuing.');
    const next = { version: 1 as const, buyerId, sellerId, generatedOffer: '', buyerOfferText: '', attemptedPaymentHash: '', triedWithoutKey: false, ...progress.current, ...update };
    sessionStorage.setItem(encryptedSessionKey, JSON.stringify(next));
    progress.current = next;
  }

  async function run(action: () => Promise<void>) {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError('');
    try { await action(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Action failed. Check status before retrying a transfer.'); }
    finally { locked.current = false; setBusy(false); }
  }

  async function refreshBalance(role: Role) {
    const node = nodes.current[role];
    if (!node) return;
    const value = await readOnchainShannons(node);
    setOnchain((previous) => ({ ...previous, [role]: value }));
  }

  async function refresh(role: Role) {
    const node = nodes.current[role];
    if (!node) return;
    const channel = await readChannel(node);
    const { peers } = await node.listPeers();
    setConnected((previous) => ({ ...previous, [role]: peers.some(peer => peer.pubkey.replace(/^0x/i, '').toLowerCase() === bottle.pubkey.slice(2)) }));
    setChannels((previous) => ({ ...previous, [role]: channel }));
    await refreshBalance(role).catch(() => {});
  }

  async function start(role: Role) {
    if (nodes.current[role]) return;
    const session = sessions.current[role] ??= createBrowserNodeSession();
    let started: FiberBrowserNode | undefined;
    await session.start(role === 'buyer' ? encryptedBuyerProfile : encryptedSellerProfile, async (track) => {
      started = await startRole(role, track);
    });
    if (!started) return;
    nodes.current[role] = started;
    const info = await started.nodeInfo();
    setAddresses((previous) => ({ ...previous, [role]: scriptToAddress(info.default_funding_lock_script, 'testnet') }));
    if (await readChannel(started)) await started.connectPeer(bottle);
    await refresh(role);
  }

  async function open(role: Role) {
    const node = nodes.current[role];
    if (!node) return;
    const channel = await connectAndOpenChannel(node);
    setChannels((previous) => ({ ...previous, [role]: channel }));
    await refresh(role);
    setStatus(channel && ready(channel) ? 'Channel ready.' : 'Opening submitted. Refresh after the funding transaction confirms.');
  }

  async function moveLiquidity() {
    const node = nodes.current.seller;
    if (!node) return;
    const id = savedNodeIdentifier(localStorage, encryptedSellerProfile);
    const storageKey = `fiber-docs:encrypted-inbound:${id}`;
    const existing = sessionStorage.getItem(storageKey);
    if (existing === 'submitting') throw new Error('Transfer outcome unknown. Review payment history before sending again.');
    let result: GetPaymentResult;
    if (existing) result = await node.getPayment({ payment_hash: existing as `0x${string}` });
    else {
      sessionStorage.setItem(storageKey, 'submitting');
      result = await node.sendPayment({ target_pubkey: bottle.pubkey, amount: '0x1dcd65000', keysend: true });
      sessionStorage.setItem(storageKey, result.payment_hash);
    }
    if (!['Success', 'Failed'].includes(result.status)) result = await node.waitForPayment(result.payment_hash, { timeout: 60_000, interval: 1_000 });
    if (result.status === 'Failed') sessionStorage.removeItem(storageKey);
    setStatus(`Liquidity transfer: ${result.status}`);
    await refresh('seller');
  }

  const channelReady = (role: Role) => Boolean(connected[role] && channels[role] && ready(channels[role]!));
  const routeFor = (priceCkb: number) => Boolean(channelReady('buyer') && channelReady('seller')
    && BigInt(channels.buyer!.local_balance) >= priceShannons(priceCkb)
    && BigInt(channels.seller!.remote_balance) >= priceShannons(priceCkb));

  async function makeOffer() {
    if (!nodes.current.seller || !channels.seller || !routeFor(price) || generated || attempt) return;
    let fileEntry: Bundle['file'] = null;
    let attachment: Listing['attachment'] = null;
    if (file) {
      if (file.size > maxAttachmentBytes) throw new Error(`The attachment must be ${maxAttachmentBytes / 1024} KB or smaller.`);
      fileEntry = { name: file.name, type: file.type, base64: bytesToBase64(new Uint8Array(await file.arrayBuffer())) };
      attachment = { name: file.name, type: file.type, size: file.size };
    }
    const listing: Listing = { title: title.trim(), preview: preview.trim(), priceCkb: price, wordCount: countWords(body), attachment };
    const value = await createOffer(nodes.current.seller, channels.seller, listing, { body, file: fileEntry });
    save({ generatedOffer: value }); setGenerated(value); setStatus('Listing published. Send it to the buyer.');
  }

  function handToBuyer() {
    setReceived(generated); setTested(false);
    setStatus('Listing delivered to Buyer A. Load it to see the preview.');
  }

  async function validate() {
    if (!nodes.current.buyer) return;
    const parsed = parseOffer(received);
    await validateOffer(nodes.current.buyer, parsed);
    if (attempt && parsed.paymentHash.toLowerCase() !== attempt.toLowerCase()) throw new Error('Restore the listing for the previous payment.');
    save({ buyerOfferText: received }); setOffer(parsed); setStatus('Listing checked: Testnet invoice, listed price, matching payment hash.');
  }

  async function testLock() {
    if (!offer) return;
    try {
      await decryptBundle(offer, toHex(crypto.getRandomValues(new Uint8Array(32))), listingAad(offer.listing));
      setError('Unexpected: a guessed key opened the brief.');
    } catch { save({ triedWithoutKey: true }); setTested(true); setStatus('Decryption rejected: the key is still with the seller.'); }
  }

  async function pay() {
    if (!nodes.current.buyer || !offer || !tested || !routeFor(offer.listing.priceCkb)) return;
    const result = await payForOffer(nodes.current.buyer, offer, attempt, (hash) => {
      save({ attemptedPaymentHash: hash }); setAttempt(hash);
    }, payment?.status === 'Failed');
    await acceptPayment(result);
    await Promise.all([refresh('buyer'), refresh('seller')]);
  }

  async function acceptPayment(result: GetPaymentResult) {
    setPayment(result); setStatus(`Payment: ${result.status}`);
    if (result.status === 'Failed') setError(result.failed_error ?? 'Payment failed. Check channel liquidity before retrying.');
    if (result.status === 'Success' && result.payment_preimage && offer) {
      setKey(result.payment_preimage);
      setKeyMatches((await sha256Hex(result.payment_preimage)).toLowerCase() === offer.paymentHash.toLowerCase());
    }
  }

  async function checkPayment() {
    if (!nodes.current.buyer || !offer || !attempt) return;
    await validateOffer(nodes.current.buyer, offer);
    await acceptPayment(await nodes.current.buyer.getPayment({ payment_hash: attempt as `0x${string}` }));
  }

  async function unlock() {
    if (!offer || !key) return;
    const bundle = await decryptBundle(offer, key, listingAad(offer.listing));
    setUnlocked(bundle);
    if (bundle.file) {
      const blob = new Blob([new Uint8Array(base64ToBytes(bundle.file.base64))], { type: bundle.file.type || 'application/octet-stream' });
      setFileUrl(URL.createObjectURL(blob));
    }
    setStatus('Brief unlocked.');
  }

  async function tamperTest() {
    if (!offer || !key) return;
    const edited = { ...offer.listing, preview: `${offer.listing.preview} (edited)` };
    try { await decryptBundle(offer, key, listingAad(edited)); setTamper('Unexpected: the edited listing still decrypted.'); }
    catch { setTamper('Rejected. The same key fails once the public preview is edited, because the listing is bound to the ciphertext.'); }
  }

  function startAnotherOffer() {
    if (busy || (attempt && payment?.status !== 'Failed' && payment?.status !== 'Success')) return;
    save({ generatedOffer: '', buyerOfferText: '', attemptedPaymentHash: '', triedWithoutKey: false, completedSteps: [] });
    setGenerated(''); setReceived(''); setOffer(null); setAttempt(''); setTested(false);
    setPayment(null); setKey(''); setKeyMatches(null); setUnlocked(null); setFileUrl(''); setTamper(''); setError('');
    setStatus('Write a new brief.');
  }

  const sellerOffer = generated ? (() => { try { return parseOffer(generated); } catch { return null; } })() : null;
  const listedPrice = offer?.listing.priceCkb ?? price;
  const canSubmit = Boolean(offer && tested && routeFor(listedPrice) && !key && (!attempt || payment?.status === 'Failed'));
  const steps = [
    { label: 'Nodes & channels', done: channelReady('buyer') && channelReady('seller') },
    { label: 'Publish', done: Boolean(generated) },
    { label: 'Preview', done: Boolean(offer && tested) },
    { label: 'Pay', done: payment?.status === 'Success' },
    { label: 'Read', done: Boolean(unlocked) },
  ];
  const isImage = Boolean(unlocked?.file?.type.startsWith('image/'));

  return <main>
    <header className="hero">
      <p className="eyebrow">Fiber Testnet · pay to unlock</p>
      <h1>Brief Unlock</h1>
      <p className="lede">Sell a research brief with a free preview. The buyer pays a Fiber invoice, and the payment reveals the key that opens the full brief and its file.</p>
      <ol className="steps">{steps.map((step, index) => <li key={step.label} className={step.done ? 'done' : ''}><span>{step.done ? '✓' : index + 1}</span>{step.label}</li>)}</ol>
    </header>
    <div className="feedback">{status && <p className="status" role="status">{status}</p>}{error && <p className="alert" role="alert">{error}</p>}</div>

    <section className="block">
      <p className="step">1 · Start both browser nodes and open channels with Bottle B</p>
      <div className="grid">{(['buyer', 'seller'] as const).map((role) => {
        const channel = channels[role];
        return <section className="card node" key={role}>
          <header className="node-head">
            <span className="badge">{role === 'buyer' ? 'A' : 'C'}</span>
            <div><p className="label">{roleName[role]}</p><h3>{addresses[role] ? 'Node running' : 'Not started'}</h3></div>
            <span className={`dot ${addresses[role] ? 'on' : ''}`} />
          </header>
          {!addresses[role] && <button className="primary" disabled={!loaded || busy} onClick={() => void run(() => start(role))}>Start node</button>}
          {addresses[role] && <>
            <dl className="facts">
              <div><dt>Funding address</dt><dd><code title={addresses[role]}>{short(addresses[role]!, 14, 10)}</code>
                <button className="link" onClick={() => void navigator.clipboard.writeText(addresses[role]!).then(() => setStatus('Address copied.'))}>Copy</button>
                <a className="link" href="https://faucet.nervos.org" target="_blank" rel="noreferrer">Faucet ↗</a></dd></div>
              <div><dt>On-chain</dt><dd><b>{onchain[role] === undefined ? '—' : Number(onchain[role]! / 1_000_000n) / 100}</b> CKB
                <button className="link" disabled={busy} onClick={() => void run(() => refreshBalance(role))}>Refresh</button></dd></div>
            </dl>
            {channel
              ? <div className="channel"><div className="pills"><span className={`pill ${ready(channel) ? 'ok' : ''}`}>{channel.state.state_name}</span>{!connected[role] && <span className="pill">Connecting to Bottle…</span>}</div><Bar left={channel.local_balance} right={channel.remote_balance} leftLabel={role === 'buyer' ? 'Buyer A' : 'Seller C'} /></div>
              : <p className="hint">{channelFundingGuidance}</p>}
            <div className="actions">
              <button disabled={busy} onClick={() => void run(() => open(role))}>{channel ? 'Reconnect / check channel' : `Open ${channelFundingCkb} CKB channel`}</button>
              <button disabled={busy} onClick={() => void run(() => refresh(role))}>Refresh status</button>
            </div>
          </>}
        </section>;
      })}</div>
      <details className="fold"><summary>Optional: send 5 CKB from Seller C to Bottle B</summary>
        <p className="hint">Fresh channels already give Bottle 150 CKB on the seller&apos;s channel, which covers every price here. This only shows the balances moving.</p>
        <button disabled={busy || !channels.seller || !ready(channels.seller) || BigInt(channels.seller.local_balance) < 500_000_000n} onClick={() => void run(moveLiquidity)}>Send / check 5 CKB transfer</button>
      </details>
    </section>

    <div className="grid exchange">
      <section className="card seller">
        <p className="step">2 · Seller C publishes</p>
        <h2>Write a brief</h2>
        <label>Title<input value={title} maxLength={maxTitleLength} disabled={busy || Boolean(generated)} onChange={e => setTitle(e.target.value)} /></label>
        <label>Free preview <small>public, anyone can read it</small><textarea className="short" maxLength={maxPreviewLength} value={preview} disabled={busy || Boolean(generated)} onChange={e => setPreview(e.target.value)} /></label>
        <div className="field"><span>Price</span><div className="seg">{priceOptions.map(option =>
          <button key={option} className={option === price ? 'on' : ''} disabled={busy || Boolean(generated)} onClick={() => setPrice(option)}>{option} CKB</button>)}</div></div>
        <label>Full brief <small>encrypted, {countWords(body)} words</small><textarea className="tall" value={body} disabled={busy || Boolean(generated)} onChange={e => setBody(e.target.value)} /></label>
        <label>Attachment <small>optional, encrypted, up to {maxAttachmentBytes / 1024} KB</small>
          <input type="file" disabled={busy || Boolean(generated)} onChange={e => setFile(e.target.files?.[0] ?? null)} /></label>
        {!generated && <button className="primary" disabled={busy || !routeFor(price) || !title.trim() || !preview.trim() || !body.trim() || Boolean(attempt)} onClick={() => void run(makeOffer)}>
          Encrypt &amp; list for {price} CKB</button>}
        {!generated && !routeFor(price) && <p className="hint">Waiting for both channels to be ready and connected to Bottle. Publishing creates a real Testnet invoice.</p>}
        {generated && <div className="published">
          <p className="ok">✓ Listed for {sellerOffer?.listing.priceCkb ?? price} CKB</p>
          <dl className="facts"><div><dt>Invoice payment hash</dt><dd><code>{sellerOffer ? short(sellerOffer.paymentHash, 18, 12) : ''}</code></dd></div></dl>
          <div className="actions">
            <button className="primary" disabled={busy || received === generated} onClick={handToBuyer}>Send listing to buyer →</button>
            <button disabled={busy} onClick={() => void run(async () => { await navigator.clipboard.writeText(generated); setStatus('Listing JSON copied.'); })}>Copy listing JSON</button>
          </div>
          <details className="fold"><summary>Public listing JSON (no key inside)</summary><pre className="json">{generated}</pre></details>
        </div>}
      </section>

      <section className="card buyer">
        <p className="step">3 · Buyer A previews and pays</p>
        <h2>Store</h2>
        {!offer && <>
          <label>Listing JSON<textarea value={received} placeholder="Paste a listing, or press “Send listing to buyer”." disabled={busy || Boolean(attempt)} onChange={e => { setReceived(e.target.value); setTested(false); }} /></label>
          <button className="primary" disabled={busy || !received || !addresses.buyer} onClick={() => void run(validate)}>Load listing</button>
        </>}
        {offer && <article className="listing">
          <div className="listing-head"><h3>{offer.listing.title}</h3><span className="price">{offer.listing.priceCkb} CKB</span></div>
          <p className="preview">{offer.listing.preview}</p>
          <p className="meta">{offer.listing.wordCount} words{offer.listing.attachment ? ` · file: ${offer.listing.attachment.name} (${kb(offer.listing.attachment.size)})` : ''}</p>
          <p className="checked">✓ Invoice checked: Testnet, {offer.listing.priceCkb} CKB, same payment hash as the listing</p>
          {!unlocked && <div className="locked">
            <div className="blur" aria-hidden="true">{Array.from({ length: 6 }, (_, i) => <i key={i} style={{ width: `${92 - ((i * 17) % 35)}%` }} />)}</div>
            <span><Lock /> Full brief{offer.listing.attachment ? ' and file' : ''} locked</span>
          </div>}
          {unlocked && <p className="ok">✓ Unlocked. The full brief is below.</p>}
          {tested && !key && <p className="reject">✕ Decryption rejected. AES-GCM refused a guessed key, so only the seller&apos;s key can open this.</p>}
          <div className="actions">
            {!tested && <button disabled={busy} onClick={() => void run(testLock)}>Try to open without paying</button>}
            {canSubmit && <button className="primary" disabled={busy} onClick={() => void run(pay)}>{attempt ? 'Retry failed payment' : `Pay ${offer.listing.priceCkb} CKB & unlock`}</button>}
            {attempt && !key && <button disabled={busy || !addresses.buyer} onClick={() => void run(checkPayment)}>Check payment status</button>}
            {key && !unlocked && <button className="primary" disabled={busy} onClick={() => void run(unlock)}>Decrypt with revealed key</button>}
          </div>
        </article>}
      </section>
    </div>

    {payment?.status === 'Success' && <section className="card receipt">
      <p className="step">4 · Receipt</p>
      <h2>Payment completed</h2>
      <div className="stats">
        <div><span>Paid to seller</span><b>{offer?.listing.priceCkb ?? '—'} CKB</b></div>
        <div><span>Routing fee</span><b>{ckb(payment.fee)} CKB</b></div>
        <div><span>Total paid</span><b>{ckb(priceShannons(offer?.listing.priceCkb ?? 0) + BigInt(payment.fee))} CKB</b></div>
        <div><span>Status</span><b className="ok">{payment.status}</b></div>
      </div>
      <dl className="facts wide">
        <div><dt>Payment hash</dt><dd><code>{payment.payment_hash}</code></dd></div>
        <div><dt>Revealed key (payment preimage)</dt><dd><code>{key || '—'}</code></dd></div>
      </dl>
      {keyMatches !== null && <p className={keyMatches ? 'ok' : 'reject'}>{keyMatches ? '✓ SHA-256(revealed key) equals the payment hash' : '✕ The revealed key does not match the payment hash'}</p>}
    </section>}

    {unlocked && offer && <section className="card result">
      <p className="step">5 · Unlocked</p>
      <h2>{offer.listing.title}</h2>
      <pre>{unlocked.body}</pre>
      {unlocked.file && fileUrl && <div className="file">
        {isImage && <img src={fileUrl} alt={unlocked.file.name} />}
        <a className="button" href={fileUrl} download={unlocked.file.name}>Download {unlocked.file.name}</a>
      </div>}
      <div className="tamper">
        <button disabled={busy || Boolean(tamper)} onClick={() => void run(tamperTest)}>Integrity test: same key, edited preview</button>
        {tamper && <p className={tamper.startsWith('Rejected') ? 'ok' : 'reject'}>{tamper}</p>}
      </div>
    </section>}

    {(generated || received) && (!attempt || payment?.status === 'Failed' || payment?.status === 'Success') && <button className="ghost" disabled={busy} onClick={() => void run(async () => startAnotherOffer())}>Start another brief</button>}
    <footer>Built from the Fiber docs starter “Unlock Encrypted Data with a Fiber Payment”. Testnet only: never send Mainnet CKB.</footer>
  </main>;
}
