function traceFromSurveys(collar, surveys, incFromVert) {
  // Minimum Curvature method (Sawaryn & Thorogood, 2003 SPE 84246)
  // Z increases up; we subtract TVD (true vertical depth = projection of MD onto vertical axis).
  const trace = [];
  const cx = Number(collar.x), cy = Number(collar.y), cz = Number(collar.z);
  if (![cx, cy, cz].every(Number.isFinite)) return [];
  let X = cx;
  let Y = cy;
  let Z = cz;
  trace.push({ depth: 0, x: X, y: Y, z: Z });

  for (let i = 0; i < surveys.length - 1; i++) {
    const s1 = surveys[i], s2 = surveys[i+1];
    const md1 = s1.depth, md2 = s2.depth;
    if (md2 <= md1) continue;
    const dMD = md2 - md1;
    const inc1 = incFromVert(s1.dip);
    const inc2 = incFromVert(s2.dip);
    const az1 = Math.PI / 180 * s1.azimuth;
    const az2 = Math.PI / 180 * s2.azimuth;
    const cosBeta = Math.cos(inc2 - inc1) - Math.sin(inc1) * Math.sin(inc2) * (1 - Math.cos(az2 - az1));
    const beta = Math.acos(Math.max(-1, Math.min(1, cosBeta)));
    const RF = (Math.abs(beta) < 1e-6) ? 1 : (2 / beta) * Math.tan(beta / 2);
    const dN = dMD / 2 * (Math.sin(inc1) * Math.cos(az1) + Math.sin(inc2) * Math.cos(az2)) * RF;
    const dE = dMD / 2 * (Math.sin(inc1) * Math.sin(az1) + Math.sin(inc2) * Math.sin(az2)) * RF;
    const dTVD = dMD / 2 * (Math.cos(inc1) + Math.cos(inc2)) * RF;
    X += dE; Y += dN; Z -= dTVD;
    trace.push({ depth: md2, x: X, y: Y, z: Z });
  }
  // Extend final segment to total_depth if collar.depth > last survey depth
  const totalDepth = Number(collar.depth);
  const lastSurvey = surveys[surveys.length - 1];
  if (totalDepth && totalDepth > lastSurvey.depth + 0.01) {
    const dMD = totalDepth - lastSurvey.depth;
    const inc = incFromVert(lastSurvey.dip);
    const az = Math.PI / 180 * lastSurvey.azimuth;
    const dN = dMD * Math.sin(inc) * Math.cos(az);
    const dE = dMD * Math.sin(inc) * Math.sin(az);
    const dTVD = dMD * Math.cos(inc);
    X += dE; Y += dN; Z -= dTVD;
    trace.push({ depth: totalDepth, x: X, y: Y, z: Z });
  }
  return trace;
}

