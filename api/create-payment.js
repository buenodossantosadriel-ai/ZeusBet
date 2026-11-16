import { randomUUID } from "node:crypto";

const SUPABASE_URL = (process.env.SUPABASE_CAM_URL || process.env.SUPABASE_URL || "").replace(/\/$/, "");
const SUPABASE_SERVICE_ROLE_KEY = (process.env.SUPABASE_CAMERA_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();

function findKey(obj, keys) {
  if (!obj || typeof obj !== "object") return null;
  for (const key of keys) {
    if (obj[key]) return obj[key];
  }
  for (const value of Object.values(obj)) {
    const found = findKey(value, keys);
    if (found) return found;
  }
  return null;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });

  const mpToken = (process.env.MP_TOKEN || "").trim();
  if (!mpToken || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: "Configuração de pagamento incompleta na Vercel." });
  }

  try {
    const authorization = req.headers.authorization || "";
    const accessToken = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
    if (!accessToken) return res.status(401).json({ error: "Faça login para gerar o Pix." });

    // O ID e o e-mail vêm da sessão validada no Supabase, nunca do corpo enviado pelo navegador.
    const authResponse = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${accessToken}`
      }
    });
    if (!authResponse.ok) return res.status(401).json({ error: "Sessão inválida. Entre novamente." });

    const user = await authResponse.json();
    if (!user?.id || !user?.email) return res.status(401).json({ error: "Não foi possível identificar sua conta." });

    const mpResponse = await fetch("https://api.mercadopago.com/v1/orders", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${mpToken}`,
        "Content-Type": "application/json",
        "X-Idempotency-Key": `zeus-${user.id}-${randomUUID()}`
      },
      body: JSON.stringify({
        type: "online",
        processing_mode: "automatic",
        total_amount: "19.90",
        external_reference: user.id,
        description: "ZeusBet Acesso 30 dias",
        payer: {
          email: user.email,
          first_name: "Cliente",
          last_name: "ZeusBet"
        },
        transactions: {
          payments: [{
            amount: "19.90",
            payment_method: {
              id: "pix",
              type: "bank_transfer"
            }
          }]
        }
      })
    });

    const mpData = await mpResponse.json().catch(() => ({}));
    if (!mpResponse.ok) {
      console.error("Erro Mercado Pago ao criar order:", mpData);
      return res.status(502).json({ error: "O Mercado Pago não conseguiu gerar o Pix. Tente novamente." });
    }

    const qrCode = findKey(mpData, ["qr_code", "qrCode", "pix_qr_code"]);
    const qrCodeBase64 = findKey(mpData, ["qr_code_base64", "qrCodeBase64"]);
    const ticketUrl = findKey(mpData, ["ticket_url", "ticketUrl", "external_resource_url"]);

    if (!qrCode && !qrCodeBase64) {
      console.error("Order criada sem QR Pix retornado:", mpData?.id, mpData?.status);
      return res.status(502).json({ error: "O Mercado Pago criou o pedido, mas não retornou o QR Code Pix. Verifique o pedido no painel do Mercado Pago." });
    }

    return res.status(200).json({
      id: mpData.id,
      status: mpData.status,
      qr_code: qrCode || "",
      qr_code_base64: qrCodeBase64 || "",
      ticket_url: ticketUrl || ""
    });
  } catch (error) {
    console.error("Erro create-payment:", error);
    return res.status(500).json({ error: "Erro interno ao gerar o Pix." });
  }
}
