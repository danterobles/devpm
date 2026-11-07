/**
 * Envuelve cada vista HTML en layouts/main.ejs.
 * res.render('pages/x', data) -> renderiza la página y la inserta como `body` del layout.
 * Usar { layout: false } para renderizar sin layout (parciales/fragmentos).
 */
export function layout(defaultLayout = 'layouts/main') {
  return function layoutMiddleware(req, res, next) {
    res.locals.currentPath = req.path; // para marcar la sección activa del menú
    const render = res.render.bind(res);
    res.render = (view, options = {}, callback) => {
      const { layout: layoutName = defaultLayout, ...data } = options;
      if (layoutName === false) return render(view, data, callback);
      return render(view, data, (err, body) => {
        if (err) return callback ? callback(err) : next(err);
        return render(layoutName, { ...data, body }, callback);
      });
    };
    next();
  };
}
