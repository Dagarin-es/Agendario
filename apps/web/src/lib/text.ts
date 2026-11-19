/** Primera letra en mayúscula para mostrar («instagram» → «Instagram»); no cambia lo guardado. */
export const capLabel = (l: string) => {
  const t = (l ?? "").trim();
  return t ? t[0]!.toLocaleUpperCase("es") + t.slice(1) : t;
};
