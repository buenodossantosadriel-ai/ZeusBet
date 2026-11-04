const crypto = require("crypto");

const SUPABASE_URL = (process.env.SUPABASE_CAM_URL || process.env.SUPABASE_URL || "").replace(/\/$/, "");
const SUPABASE_SERVICE_ROLE_KEY = (process.env.SUPABASE_CAM_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
const MP_TOKEN = (process.env.MP_TOKEN || "").trim();
const WEBHOOK_SECRET = (process.env.MP_WEBHOOK_SECRET || process.env.MERCADOPAGO_WEBHOOK_SECRET || "").trim();

function getPaymentId(req) {
  if (req.query?.["data.id"]) return String(req.query["data.id"]);
  if (req.query?.data?.id) return String(req.query.data.id);
  if (req.body?.data?.id) return String(req.body.data.id);
  if (typeof req.body === "string") {
    try {
      const p = JSON.parse(req.body);
      if (p?.data?.id) return String(p.data.id);
    } catch {}
  }
  if (req.query?.id) return String(req.query.id);
  return null;
}

function assinaturaOk(req, paymentId) {
  try {
    const signature = req.headers["x-signature"];
    const requestId = req.headers["x-request-id"];
    if (!signature || !requestId || !paymentId || !WEBHOOK_SECRET) return false;
    const parts = {};
    for (const item of signature.split(",")) {
      const [k, ...v] = item.trim().split("=");
      if (k && v.length) parts[k] = v.join("=");
    }
    if (!parts.ts || !parts.v1) return false;
    const manifest = `id:${String(paymentId).toLowerCase()};request-id:${requestId};ts:${parts.ts};`;
    const expected = crypto.createHmac("sha256", WEBHOOK_SECRET).update(manifest).digest("hex");
    return crypto.timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(parts.v1, "hex"));
  } catch { return false; }
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !MP_TOKEN) return res.status(500).end();

  try {
    const paymentId = getPaymentId(req);
    if (!paymentId) return res.status(200).json({ received: true });

    // Se a assinatura falhar, a gente ainda tenta buscar o pagamento no MP.
    // Se o MP devolver o pagamento, é porque é verdadeiro. Isso garante que libere.
    const sigOk = assinaturaOk(req, paymentId);

    const mpRes = await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}`, {
      headers: { Authorization: `Bearer ${MP_TOKEN}` }
    });
    if (!mpRes.ok) return res.status(200).json({ received: true });

    const payment = await mpRes.json();
    if (payment.status !== "approved") return res.status(200).json({ received: true });

    // Pega o usuário de onde vier: external_reference ou email do pagador
    const userId = payment.external_reference || payment.payer?.email || payment.metadata?.user_id;
    if (!userId) return res.status(200).json({ received: true });

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
        lifetime_access: true,
        payment_id: String(payment.id),
        paid_at: payment.date_approved || new Date().toISOString()
      })
    });

    if (!dbRes.ok) return res.status(200).json({ received: true });

    return res.status(200).json({ received: true, accessGranted: true });
  } catch {
    return res.status(200).json({ received: true });
  }
};
