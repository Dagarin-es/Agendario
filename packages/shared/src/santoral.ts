/**
 * Santoral español (fechas tradicionales de la onomástica más extendida). No es exhaustivo:
 * para nombres con varias fechas se usa la más celebrada en España. Cada contacto puede
 * desactivar el santo automático o poner otra fecha a mano.
 */
const raw: Record<string, string> = {
  // --- Hombres ---
  adrian: "09-08", agustin: "08-28", alberto: "11-15", alejandro: "02-26", alfonso: "08-01", alvaro: "02-19",
  andres: "11-30", antonio: "06-13", bartolome: "08-24", benito: "07-11", bernardo: "08-20", blas: "02-03",
  carlos: "11-04", cayetano: "08-07", cristobal: "07-10", daniel: "07-21", david: "12-29", diego: "11-13",
  domingo: "08-08", eduardo: "10-13", emilio: "05-22", enrique: "07-13", esteban: "12-26", felipe: "05-03",
  fernando: "05-30", francisco: "10-04", gabriel: "09-29", gonzalo: "01-10", gregorio: "09-03", guillermo: "06-25",
  ignacio: "07-31", isidro: "05-15", jacobo: "07-25", jaime: "07-25", javier: "12-03", jesus: "01-01",
  joaquin: "07-26", jorge: "04-23", jose: "03-19", juan: "06-24", lorenzo: "08-10", lucas: "10-18",
  manuel: "01-01", marcos: "04-25", mario: "01-19", martin: "11-11", mateo: "09-21", miguel: "09-29",
  nicolas: "12-06", oscar: "02-03", pablo: "06-29", pascual: "05-17", patricio: "03-17", pedro: "06-29",
  rafael: "09-29", ramon: "08-31", ricardo: "04-03", rodrigo: "03-13", roque: "08-16", salvador: "08-06",
  santiago: "07-25", sebastian: "01-20", sergio: "10-07", simon: "10-28", tomas: "07-03", valentin: "02-14",
  vicente: "01-22", yago: "07-25", iago: "07-25", xavier: "12-03", jordi: "04-23", josep: "03-19",
  joan: "06-24", pau: "06-29", pere: "06-29", miquel: "09-29", francesc: "10-04", xose: "03-19", xoan: "06-24",
  // --- Mujeres ---
  agueda: "02-05", ana: "07-26", asuncion: "08-15", barbara: "12-04", beatriz: "07-29", begona: "10-11",
  blanca: "08-05", carmen: "07-16", catalina: "11-25", cecilia: "11-22", clara: "08-11", concepcion: "12-08",
  cristina: "07-24", dolores: "09-15", elena: "08-18", esperanza: "12-18", esther: "07-01", ester: "07-01",
  eva: "12-24", fatima: "05-13", francisca: "03-09", ines: "01-21", inmaculada: "12-08", josefa: "03-19",
  lourdes: "02-11", lucia: "12-13", luisa: "03-15", magdalena: "07-22", maria: "09-12", marta: "07-29",
  mercedes: "09-24", montserrat: "04-27", montse: "04-27", natalia: "07-27", nieves: "08-05", nuria: "09-08",
  paula: "01-26", pilar: "10-12", rosa: "08-23", rosario: "10-07", silvia: "11-03", susana: "08-11",
  teresa: "10-15", anna: "07-26", marina: "07-18", milagros: "09-08", angustias: "09-15", candelaria: "02-02",
  candela: "02-02", covadonga: "09-08", guadalupe: "12-12", macarena: "12-18", merce: "09-24",
};

/** Hipocorísticos y formas cortas → nombre del santoral. */
const aliases: Record<string, string> = {
  pepe: "jose", pepa: "josefa", paco: "francisco", paca: "francisca", paqui: "francisca", fran: "francisco",
  curro: "francisco", manolo: "manuel", manoli: "manuel", nacho: "ignacio", quique: "enrique", kike: "enrique",
  toni: "antonio", tono: "antonio", lola: "dolores", loli: "dolores", pili: "pilar", charo: "rosario",
  conchi: "concepcion", concha: "concepcion", conchita: "concepcion", inma: "inmaculada", merche: "mercedes",
  mari: "maria", dani: "daniel", alex: "alejandro", rafa: "rafael", javi: "javier", chema: "jose", juanma: "juan",
  nando: "fernando", fer: "fernando", santi: "santiago", jaume: "jaime", tere: "teresa", maite: "teresa",
  bea: "beatriz", cris: "cristina", lucas: "lucas", pablito: "pablo", jose: "jose", nieves: "nieves",
};

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/ñ/g, "\u0001")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\u0001/g, "n")
    .replace(/[^a-z\s-]/g, " ")
    .trim();

/**
 * Fecha del santo («--MM-DD») a partir del nombre de pila, o null si no está en el santoral.
 * «María del Carmen», «Mari Carmen» o «María José» usan el segundo nombre; «José María», el primero.
 */
export function saintDateFor(givenName: string): string | null {
  const tokens = norm(givenName).split(/[\s-]+/).filter((t) => t && !["de", "del", "la", "las", "los", "y"].includes(t));
  if (!tokens.length) return null;
  const look = (t: string) => raw[aliases[t] ?? t] ?? null;
  const first = tokens[0]!;
  if ((first === "maria" || first === "mari" || first === "ma") && tokens[1]) {
    const second = look(tokens[1]);
    if (second) return `--${second}`;
  }
  const d = look(first);
  return d ? `--${d}` : null;
}
