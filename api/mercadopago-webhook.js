const crypto = require("crypto");

const SUPABASE_URL = (process.env.SUPABASE_CAM_URL || process.env.SUPABASE_URL || "").replace(/\/$/, "");
const SUPABASE_SERVICE_ROLE_KEY = (process.env.SUPABASE_CAMERA_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
const MP_TOKEN = (process.env.MP_TOKEN || "").trim();
const WEBHOOK_SECRET = (process.env.MP_WEBHOOK_SECRET || process.env.MERCADOPAGO_WEBHOOK_SECRET || "").trim();
const PLAN_PRICE = 19.90;
const PLAN_DAYS = 30;

function getEvent(req) {
  const body = typeof req.body === "string"
    ? (() => { try { return JSON.parse(req.body); } catch { return {}; } })()
    : (req.body || {});
  const type = String(body.type || body.topic || req.query?.type || req.query?.topic || "").toLowerCase();
  const id = body.data?.id || body.data?.ID || req.query?.["data.id"] || req.query?.id || null;
  return { type, id: id ? String(id) : null };
}

function validSignature(req, eventId) {
  try {
    const signature = req.headers["x-signature"];
    const requestId = req.headers["x-request-id"];
    if (!signature || !requestId || !eventId || !WEBHOOK_SECRET) return false;

    const parts = {};
    for (const item of signature.split(",")) {
      const [key, ...value] = item.trim().split("=");
      if (key && value.length) parts[key] = value.join("=");
    }
    if (!parts.ts || !parts.v1 || !/^[a-f0-9]{64}$/i.test(parts.v1)) return false;

    const manifest = `id:${String(eventId).toLowerCase()};request-id:${requestId};ts:${parts.ts};`;
    const expected = crypto.createHmac("sha256", WEBHOOK_SECRET).update(manifest).digest("hex");
    const received = Buffer.from(parts.v1, "hex");
    const calculated = Buffer.from(expected, "hex");
    return received.length === calculated.length && crypto.timingSafeEqual(received, calculated);
  } catch {
    return false;
  }
}

function isUUID(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || ""));
}

async function resolveUserId(rawValue, payerEmail) {
  const candidate = String(rawValue || "").trim();
  if (isUUID(candidate)) return candidate;

  const email = candidate.includes("@") ? candidate : String(payerEmail || "");
  if (!email.includes("@")) return null;

  const response = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?email=${encodeURIComponent(email)}`, {
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
    }
  });
  if (!response.ok) return null;

  const data = await response.json();
  const user = data?.users?.[0] || data?.[0] || data?.user || null;
  return isUUID(user?.id) ? String(user.id) : null;
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Método não permitido." });
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !MP_TOKEN) {
    return res.status(500).json({ error: "Configuração de pagamento incompleta no servidor." });
  }
  if (!WEBHOOK_SECRET) {
    console.error("MP_WEBHOOK_SECRET não configurado.");
    return res.status(500).json({ error: "Segredo do webhook não configurado." });
  }

  try {
    const { type, id: eventId } = getEvent(req);
    if (!eventId) return res.status(400).json({ error: "Notificação sem ID do recurso." });
    if (!validSignature(req, eventId)) return res.status(401).json({ error: "Assinatura do webhook inválida." });

    let userReference = null;
    let payerEmail = "";
    let paymentId = null;
    let paidAmount = 0;
    let currency = "";
    let paymentStatus = "";
    let approvedAt = null;

    if (type === "order") {
      const response = await fetch(`https://api.mercadopago.com/v1/orders/${encodeURIComponent(eventId)}`, {
        headers: { Authorization: `Bearer ${MP_TOKEN}` }
      });
      if (!response.ok) return res.status(502).json({ received: false, reason: "Não foi possível consultar o pedido no Mercado Pago." });

      const order = await response.json();
      const orderStatus = String(order.status || "").toLowerCase();
      const payments = order.transactions?.payments || order.payments || [];
      const paidPayment = payments.find(item =>
        ["processed", "approved", "accredited"].includes(String(item.status || "").toLowerCase())
      );

      if (!["processed", "approved", "paid"].includes(orderStatus) || !paidPayment) {
        return res.status(200).json({ received: true, accessGranted: false, reason: "Pedido ainda não confirmado como pago." });
      }

      paymentStatus = String(paidPayment.status || orderStatus).toLowerCase();
      paymentId = paidPayment.id ? String(paidPayment.id) : eventId;
      paidAmount = Number(paidPayment.paid_amount ?? paidPayment.amount ?? order.total_paid_amount ?? 0);
      currency = String(paidPayment.currency_id || order.currency_id || "");
      userReference = order.external_reference || order.metadata?.user_id || null;
      payerEmail = order.payer?.email || "";
      approvedAt = order.date_approved || order.last_updated || order.date_created || null;

      const methodId = String(paidPayment.payment_method?.id || "").toLowerCase();
      const methodType = String(paidPayment.payment_method?.type || "").toLowerCase();
      if (methodId !== "pix" && methodType !== "bank_transfer") {
        return res.status(200).json({ received: true, accessGranted: false, reason: "Meio de pagamento não corresponde ao Pix." });
      }
    } else if (type === "payment") {
      const response = await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(eventId)}`, {
        headers: { Authorization: `Bearer ${MP_TOKEN}` }
      });
      if (!response.ok) return res.status(502).json({ received: false, reason: "Não foi possível consultar o pagamento." });

      const payment = await response.json();
      paymentStatus = String(payment.status || "").toLowerCase();
      if (paymentStatus !== "approved") {
        return res.status(200).json({ received: true, accessGranted: false, reason: "Pagamento ainda não aprovado." });
      }
      paymentId = String(payment.id || eventId);
      paidAmount = Number(payment.transaction_amount || 0);
      currency = String(payment.currency_id || "");
      userReference = payment.external_reference || payment.metadata?.user_id || null;
      payerEmail = payment.payer?.email || "";
      approvedAt = payment.date_approved || payment.date_created || null;
      if (String(payment.payment_method_id || "").toLowerCase() !== "pix") {
        return res.status(200).json({ received: true, accessGranted: false, reason: "Meio de pagamento não corresponde ao Pix." });
      }
    } else {
      return res.status(200).json({ received: true, ignored: true, reason: "Tipo de evento não utilizado." });
    }

    if (currency !== "BRL" || !Number.isFinite(paidAmount) || paidAmount < PLAN_PRICE) {
      return res.status(200).json({ received: true, accessGranted: false, reason: "Valor ou moeda do pagamento não confere com o plano." });
    }

    const userId = await resolveUserId(userReference, payerEmail);
    if (!userId) return res.status(200).json({ received: true, accessGranted: false, reason: "Usuário do pagamento não identificado." });

    // Idempotência: se este pagamento já é o pagamento registrado no acesso atual,
    // a repetição do webhook não renova o prazo novamente.
    const currentResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/user_access?user_id=eq.${encodeURIComponent(userId)}&select=expires_at,payment_id&limit=1`,
      {
        headers: {
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
        }
      }
    );
    if (!currentResponse.ok) return res.status(502).json({ received: false, reason: "Não foi possível consultar o acesso atual." });
    const currentRows = await currentResponse.json();
    const current = currentRows[0] || null;

    if (current?.payment_id && String(current.payment_id) === paymentId) {
      return res.status(200).json({ received: true, accessGranted: true, alreadyProcessed: true });
    }

    const paidAtDate = approvedAt && Number.isFinite(new Date(approvedAt).getTime())
      ? new Date(approvedAt)
      : new Date();
    const currentExpiry = current?.expires_at ? new Date(current.expires_at) : null;
    const baseDate = currentExpiry && Number.isFinite(currentExpiry.getTime()) && currentExpiry > paidAtDate
      ? currentExpiry
      : paidAtDate;
    const expiresAt = new Date(baseDate.getTime() + PLAN_DAYS * 24 * 60 * 60 * 1000).toISOString();

    const dbResponse = await fetch(`${SUPABASE_URL}/rest/v1/user_access?on_conflict=user_id`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal"
      },
      body: JSON.stringify({
        user_id: userId,
        lifetime_access: false,
        expires_at: expiresAt,
        payment_id: paymentId,
        paid_at: paidAtDate.toISOString()
      })
    });

    if (!dbResponse.ok) {
      console.error("Falha ao gravar user_access:", await dbResponse.text());
      return res.status(502).json({ received: false, reason: "Não foi possível liberar o plano no banco de dados." });
    }

    return res.status(200).json({ received: true, accessGranted: true, expiresAt });
  } catch (error) {
    console.error("Erro no webhook Mercado Pago:", error);
    return res.status(500).json({ received: false, error: "Erro interno ao processar pagamento." });
  }
};
