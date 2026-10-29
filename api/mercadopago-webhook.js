const crypto = require("crypto");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;
const MERCADOPAGO_ACCESS_TOKEN =
  process.env.MERCADOPAGO_ACCESS_TOKEN;
const MERCADOPAGO_WEBHOOK_SECRET =
  process.env.MERCADOPAGO_WEBHOOK_SECRET;

function validarAssinatura(req, paymentId) {
  const signature = req.headers["x-signature"];
  const requestId = req.headers["x-request-id"];

  if (!signature || !requestId || !paymentId ||
      !MERCADOPAGO_WEBHOOK_SECRET) {
    return false;
  }

  const parts = {};

  for (const item of signature.split(",")) {
    const [key, ...values] = item.trim().split("=");
    if (key && values.length) {
      parts[key] = values.join("=");
    }
  }

  if (!parts.ts || !parts.v1) {
    return false;
  }

  const manifest =
    `id:${String(paymentId).toLowerCase()};` +
    `request-id:${requestId};` +
    `ts:${parts.ts};`;

  const expected = crypto
    .createHmac("sha256", MERCADOPAGO_WEBHOOK_SECRET)
    .update(manifest)
    .digest("hex");

  const received = parts.v1;

  if (!/^[a-f0-9]{64}$/i.test(received)) {
    return false;
  }

  return crypto.timingSafeEqual(
    Buffer.from(expected, "hex"),
    Buffer.from(received, "hex")
  );
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).end();
  }

  if (
    !SUPABASE_URL ||
    !SUPABASE_SERVICE_ROLE_KEY ||
    !MERCADOPAGO_ACCESS_TOKEN ||
    !MERCADOPAGO_WEBHOOK_SECRET
  ) {
    console.error("Configuração do webhook incompleta.");
    return res.status(500).end();
  }

  try {
    const paymentId =
      req.query?.["data.id"] ||
      req.query?.id ||
      req.body?.data?.id;

    if (!paymentId || !validarAssinatura(req, paymentId)) {
      return res.status(401).json({
        error: "Notificação não autenticada."
      });
    }

    // Busca os dados reais do pagamento no Mercado Pago.
    const mpResponse = await fetch(
      `https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}`,
      {
        headers: {
          Authorization: `Bearer ${MERCADOPAGO_ACCESS_TOKEN}`
        }
      }
    );

    if (!mpResponse.ok) {
      console.error("Não foi possível consultar o pagamento.");
      return res.status(502).end();
    }

    const payment = await mpResponse.json();

    // Só libera acesso para pagamento aprovado e com os dados esperados.
    if (
      payment.status !== "approved" ||
      payment.transaction_amount !== 20 ||
      payment.currency_id !== "BRL" ||
      !payment.external_reference
    ) {
      return res.status(200).json({
        received: true,
        accessGranted: false
      });
    }

    const userId = payment.external_reference;

    // Confere o formato do identificador do usuário.
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)
    ) {
      return res.status(200).json({
        received: true,
        accessGranted: false
      });
    }

    // Registra o acesso no Supabase usando credencial exclusiva do servidor.
    const dbResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/user_access?on_conflict=user_id`,
      {
        method: "POST",
        headers: {
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          "Content-Type": "application/json",
          Prefer: "resolution=merge-duplicates,return=minimal"
        },
        body: JSON.stringify({
          user_id: userId,
          lifetime_access: true,
          payment_id: String(payment.id),
          paid_at: payment.date_approved || new Date().toISOString()
        })
      }
    );

    if (!dbResponse.ok) {
      console.error("Erro ao registrar acesso:", dbResponse.status);
      return res.status(500).end();
    }

    return res.status(200).json({
      received: true,
      accessGranted: true
    });
  } catch (error) {
    console.error("Erro no webhook:", error.message);
    return res.status(500).end();
  }
};
