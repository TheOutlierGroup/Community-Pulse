export function requireBodyFields(fields) {
  return (req, res, next) => {
    for (const f of fields) {
      if (req.body[f] === undefined || req.body[f] === null || req.body[f] === '') {
        return res.status(400).json({ error: `Missing field: ${f}` });
      }
    }
    next();
  };
}
