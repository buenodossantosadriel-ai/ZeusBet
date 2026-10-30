const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL;

const SUPABASE_ANON_KEY =
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  process.env.SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({
      error: "Método não permitido."
    });
  }

  try {
    const authorization = req.headers.authorization || "";
    let tokenIssuer = "não identificado";

try {
  const token = authorization.startsWith("Bearer ")
    ? authorization.slice(7)
    : "";

  const payload = JSON.parse(
    Buffer.from(token.split(".")[1], "base64url").toString()
  );

  tokenIssuer = payload.iss || "sem issuer";
} catch (error) {
  tokenIssuer = "token não pôde ser analisado";
}

console.error("DIAGNÓSTICO SUPABASE:", {
  servidorSupabase: SUPABASE_URL
    ? new URL(SUPABASE_URL).host
    : "URL não configurada",
  emissorDoToken: tokenIssuer
});
    const token = authorization.startsWith("Bearer ")
      ? authorization.slice(7)
      : "";

    if (!token) {
      return res.status(401).json({
        error: "Faça login para consultar o acesso."
      });
    }

    // Confirma a identidade do usuário no Supabase.
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
    "ERRO SUPABASE AUTH:",
    authResponse.status,
    detalhe
  );

  return res.status(401).json({
    error: "Sessão inválida."
  });
}

    const user = await authResponse.json();

    // Consulta o registro usando a chave privada apenas no servidor.
    const accessResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/user_access?user_id=eq.${encodeURIComponent(user.id)}&select=lifetime_access,paid_at&limit=1`,
      {
        headers: {
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
        }
      }
    );

    if (!accessResponse.ok) {
      console.error("Erro ao consultar acesso:", accessResponse.status);

      return res.status(500).json({
        error: "Não foi possível consultar o acesso."
      });
    }

    const rows = await accessResponse.json();
    const record = rows[0];

    return res.status(200).json({
      authenticated: true,
      hasLifetimeAccess: record?.lifetime_access === true,
      paidAt: record?.paid_at || null
    });
  } catch (error) {
    console.error("Erro na consulta de acesso:", error.message);

    return res.status(500).json({
      error: "Erro interno ao consultar o acesso."
    });
  }
};
