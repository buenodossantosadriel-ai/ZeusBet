const { randomUUID } = require("crypto");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  process.env.SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;
const MERCADOPAGO_ACCESS_TOKEN =
  process.env.MERCADOPAGO_ACCESS_TOKEN;

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({
      error: "Método não permitido."
    });
  }

  if (
    !SUPABASE_URL ||
    !SUPABASE_ANON_KEY ||
    !SUPABASE_SERVICE_ROLE_KEY ||
    !MERCADOPAGO_ACCESS_TOKEN
  ) {
    return res.status(500).json({
      error: "Configuração do servidor incompleta."
    });
  }

  try {
    // Exige uma sessão autenticada do Supabase.
    const authorization = req.headers.authorization || "";
    const token = authorization.startsWith("Bearer ")
      ? authorization.slice(7)
      : "";

    if (!token) {
      return res.status(401).json({
        error: "Faça login para continuar."
      });
    }

    // Valida o token consultando o próprio Supabase.
    const authResponse = await fetch(
      `${SUPABASE_URL}/auth/v1/user`,
      {
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${token}`
        }
      }
    );

if (!authResponse.ok) {
  const detalhe = await authResponse.text();

  console.error(
    "Falha na autenticação Supabase:",
    authResponse.status,
    detalhe
  );

  return res.status(401).json({
    error: "Sessão inválida. Entre novamente."
  });
}

    const user = await authResponse.json();

    if (!user.id || !user.email || !user.email_confirmed_at) {
      return res.status(403).json({
        error: "Confirme seu e-mail antes de continuar."
      });
    }

    // Impede criar outra cobrança para quem já tem acesso.
    const accessResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/user_access?user_id=eq.${encodeURIComponent(user.id)}&select=lifetime_access&limit=1`,
      {
        headers: {
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
        }
      }
    );

    if (!accessResponse.ok) {
      throw new Error("Não foi possível consultar o acesso.");
    }

    const accessRows = await accessResponse.json();

    if (accessRows.some(row => row.lifetime_access === true)) {
      return res.status(409).json({
        error: "Este usuário já possui acesso vitalício."
      });
    }

    // O valor e a descrição são definidos exclusivamente no servidor.
    const paymentResponse = await fetch(
      "https://api.mercadopago.com/v1/payments",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${MERCADOPAGO_ACCESS_TOKEN}`,
          "Content-Type": "application/json",
          "X-Idempotency-Key": randomUUID()
        },
        body: JSON.stringify({
          transaction_amount: 20,
          description: "ZeusBet - Acesso vitalício às experiências demonstrativas",
          payment_method_id: "pix",
          payer: {
            email: user.email
          },
          external_reference: user.id,
          notification_url:
            "https://zeusbet.vercel.app/api/mercadopago-webhook"
        })
      }
    );

    const payment = await paymentResponse.json();

    if (!paymentResponse.ok) {
      console.error(
        "Mercado Pago recusou a solicitação:",
        payment.status,
        payment.status_detail
      );

      return res.status(502).json({
        error: "Não foi possível criar o Pix. Tente novamente mais tarde."
      });
    }

    const transaction =
      payment.point_of_interaction?.transaction_data;

    if (!transaction?.qr_code || !transaction?.qr_code_base64) {
      console.error("Resposta sem dados completos do Pix.");

      return res.status(502).json({
        error: "O Mercado Pago não retornou o QR Code esperado."
      });
    }

    return res.status(200).json({
      payment_id: payment.id,
      status: payment.status,
      amount: payment.transaction_amount,
      qr_code: transaction.qr_code,
      qr_code_base64: transaction.qr_code_base64,
      ticket_url: transaction.ticket_url
    });
  } catch (error) {
    console.error("Erro interno ao criar pagamento:", error.message);

    return res.status(500).json({
      error: "Erro interno ao preparar o pagamento."
    });
  }
};
