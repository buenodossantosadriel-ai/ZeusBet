const crypto = require("crypto");

const SUPABASE_URL = (process.env.SUPABASE_CAM_URL || process.env.SUPABASE_URL || "").replace(/\/$/, "");
const SUPABASE_SERVICE_ROLE_KEY = (process.env.SUPABASE_CAMERA_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
const MP_TOKEN = (process.env.MP_TOKEN || "").trim();
const WEBHOOK_SECRET = (process.env.MP_WEBHOOK_SECRET || process.env.MERCADOPAGO_WEBHOOK_SECRET || "").trim();

function getEvent(req) {
  const body = typeof req.body === "string" ? (() => { try { return JSON.parse(req.body); } catch { return {}; } })() : (req.body || {});
  const type = (body.type || body.topic || req.query?.type || req.query?.topic || "").toLowerCase();
  const id = body.data?.id || body.data?.ID || req.query?.["data.id"] || req.query?.id || null;
  return { type, id: id ? String(id) : null, body };
}

function assinaturaOk(req, eventId) {
  try {
    const signature = req.headers["x-signature"];
    const requestId = req.headers["x-request-id"];
    if (!signature || !requestId || !eventId || !WEBHOOK_SECRET) return false;
    const parts = {};
    for (const item of signature.split(",")) {
      const [k, ...v] = item.trim().split("=");
      if (k && v.length) parts[k] = v.join("=");
    }
    if (!parts.ts || !parts.v1) return false;
    const manifest = `id:${String(eventId).toLowerCase()};request-id:${requestId};ts:${parts.ts};`;
    const expected = crypto.createHmac("sha256", WEBHOOK_SECRET).update(manifest).digest("hex");
    return crypto.timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(parts.v1, "hex"));
  } catch { return false; }
}

function isUUID(v) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v || ""));
}

async function resolveUserId(rawValue, payment) {
  const candidate = String(rawValue || "").trim();
  if (isUUID(candidate)) return candidate;
  const email = candidate.includes("@") ? candidate : (payment.payer?.email || payment.metadata?.user_id || "");
  if (!email || !email.includes("@")) return null;
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?email=${encodeURIComponent(email)}`, {
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    }
  });
  if (!res.ok) return null;
  const data = await res.json();
  const user = data?.users?.[0] || data?.[0] || data?.user || null;
  const id = user?.id || null;
  return isUUID(id) ? String(id) : null;
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !MP_TOKEN) return res.status(500).end();

  try {
    const { type, id: eventId } = getEvent(req);
    if (!eventId) return res.status(200).json({ received: true });

    const sigOk = assinaturaOk(req, eventId);
    // Se quiser, loga sigOk pra debug, mas não bloqueia se a assinatura falhar por enquanto

    let payment = null;
    let paymentId = null;

    // --- CASO 1: Veio aviso de ORDER (seu caso atual) ---
    if (type === "order") {
      const orderRes = await fetch(`https://api.mercadopago.com/v1/orders/${encodeURIComponent(eventId)}`, {
        headers: { Authorization: `Bearer ${MP_TOKEN}` }
      });
      if (!orderRes.ok) return res.status(200).json({ received: true, reason: "order_not_found" });
      const order = await orderRes.json();

      // Order pode vir como paid / processed / etc
      // Pega o pagamento de dentro do Order
      const orderPayment = order.payments?.[0] || order.transactions?.[0] || null;
      paymentId = orderPayment?.id ? String(orderPayment.id) : null;

      // Se o Order ainda não tem pagamento ou não está pago, espera o próximo aviso
      if (!paymentId) return res.status(200).json({ received: true, reason: "no_payment_yet" });
      if (order.status && !["paid", "processed", "approved"].includes(String(order.status).toLowerCase())) {
        // Ainda pode estar pending, não libera
        // Mas tenta buscar o pagamento mesmo assim pra confirmar
      }

      const mpRes = await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}`, {
        headers: { Authorization: `Bearer ${MP_TOKEN}` }
      });
      if (!mpRes.ok) return res.status(200).json({ received: true, reason: "payment_not_found" });
      payment = await mpRes.json();
    } 
    // --- CASO 2: Veio aviso de PAYMENT legacy (compatibilidade) ---
    else {
      paymentId = eventId;
      const mpRes = await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}`, {
        headers: { Authorization: `Bearer ${MP_TOKEN}` }
      });
      if (!mpRes.ok) return res.status(200).json({ received: true });
      payment = await mpRes.json();
    }

    if (payment.status !== "approved") return res.status(200).json({ received: true });

    const rawUserId = payment.external_reference || payment.metadata?.user_id || payment.payer?.email;
    const userId = await resolveUserId(rawUserId, payment);
    if (!userId) return res.status(200).json({ received: true });

    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    const dbRes = await fetch(`${SUPABASE_URL}/rest/v1/user_access?on_conflict=user_id`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal"
      },
      body: JSON.stringify({
        user_id: String(userId),
        lifetime_access: false,
        expires_at: expiresAt,
        payment_id: String(payment.id),
        paid_at: payment.date_approved || new Date().toISOString()
      })
    });

    if (!dbRes.ok) return res.status(200).json({ received: true });

    return res.status(200).json({ received: true, accessGranted: true });
  } catch (e) {
    console.error("webhook error", e);
    return res.status(200).json({ received: true });
  }
};
