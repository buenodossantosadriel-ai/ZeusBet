module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "GET") {
    return res.status(405).json({
      success: false,
      error: "Método não permitido."
    });
  }

  const API_KEY = process.env.WEATHERAPI_KEY;

  if (!API_KEY) {
    return res.status(500).json({
      success: false,
      error: "Chave WEATHERAPI_KEY não configurada."
    });
  }

  try {
    const url = new URL(
      "https://api.weatherapi.com/v1/current.json"
    );

    url.searchParams.set("key", API_KEY);
    url.searchParams.set("q", "-29.1678,-51.1794");
    url.searchParams.set("lang", "pt");

    const response = await fetch(url);
    const data = await response.json();

    if (!response.ok) {
      return res.status(502).json({
        success: false,
        error: data.error?.message || "Falha no WeatherAPI."
      });
    }

    return res.status(200).json({
      success: true,
      localidade: data.location.name,
      temperatura: data.current.temp_c,
      sensacao_termica: data.current.feelslike_c,
      umidade: data.current.humidity,
      vento_kmh: data.current.wind_kph,
      condicao: data.current.condition.text,
      atualizado_em: data.current.last_updated
    });

  } catch (error) {
    return res.status(500).json({
      success: false,
      error: "Erro na consulta meteorológica."
    });
  }
};
