
const SUPABASE_URL =
  process.env.SUPABASE_CAM_URL || process.env.SUPABASE_URL;

const SERVICE_KEY =
  process.env.SUPABASE_CAMERA_SERVICE_ROLE_KEY;

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({
      error: "Método não permitido."
    });
  }

  if (!SUPABASE_URL || !SERVICE_KEY) {
    return res.status(500).json({
      error: "Configuração do Supabase incompleta."
    });
  }

  try {
    const endpoint =
      `${SUPABASE_URL}/rest/v1/inmet_observations` +
      "?select=id,observed_at,values,quality_status," +
      "station:inmet_stations(id,station_code,station_name," +
      "municipality,state,latitude,longitude)" +
      "&order=observed_at.desc&limit=100";

    const response = await fetch(endpoint, {
      method: "GET",
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        Accept: "application/json"
      }
    });

    if (!response.ok) {
      console.error(
        "Erro ao consultar INMET:",
        response.status,
        await response.text()
      );

      return res.status(502).json({
        error: "Falha ao consultar dados meteorológicos."
      });
    }

    const observations = await response.json();

    return res.status(200).json({
      success: true,
      count: observations.length,
      observations
    });

  } catch (error) {
    console.error("Erro INMET:", error.message);

    return res.status(500).json({
      error: "Erro interno na consulta meteorológica."
    });
  }
};
