// api/camera.js - proxy das cameras DAER
export default async function handler(req, res){
  const cam = req.query.cam
  const mapas = {
    ptz_santa_maria: "http://177.17.64.44:8090/cgi-bin/snapshot.cgi?chn=0&u=admin&p=",
    ptz_passo_fundo: "http://177.17.64.43:8090/cgi-bin/snapshot.cgi?chn=0&u=admin&p=",
    ptz_ijui: "http://177.17.64.42:8090/cgi-bin/snapshot.cgi?chn=0&u=admin&p=",
    ptz_caxias: "http://177.17.64.41:8090/cgi-bin/snapshot.cgi?chn=0&u=admin&p="
  }
  const url = mapas[cam] || mapas.ptz_santa_maria
  try{
    const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } })
    const buf = Buffer.from(await r.arrayBuffer())
    res.setHeader("Content-Type", "image/jpeg")
    res.setHeader("Cache-Control", "no-cache")
    res.setHeader("Access-Control-Allow-Origin", "*")
    res.send(buf)
  }catch(e){
    res.status(500).send("erro camera")
  }
}
