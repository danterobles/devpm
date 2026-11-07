import { z } from 'zod';

// Cada KPI con semáforo tiene su propia forma de umbral (ver `src/modules/dashboard/thresholds.js`).
const num = z.number({ error: 'Debe ser un número' }).finite('Debe ser un número');
const nonNegative = num.min(0, 'No puede ser negativo');
const percent = num.min(0, 'Mínimo 0').max(100, 'Máximo 100');

const higherBetter = z
  .strictObject({ green: nonNegative, amber: nonNegative })
  .refine((v) => v.green >= v.amber, {
    message: 'El umbral verde debe ser mayor o igual que el ámbar',
    path: ['green'],
  });

const percentHigherBetter = z
  .strictObject({ green: percent, amber: percent })
  .refine((v) => v.green >= v.amber, {
    message: 'El umbral verde debe ser mayor o igual que el ámbar',
    path: ['green'],
  });

const lowerBetter = z
  .strictObject({ greenMax: nonNegative, amberMax: nonNegative })
  .refine((v) => v.greenMax <= v.amberMax, {
    message: 'El máximo verde no puede superar al ámbar',
    path: ['greenMax'],
  });

export const thresholdsSchema = z.strictObject({
  k3: higherBetter,
  k4: higherBetter,
  k5: z
    .strictObject({ greenMargin: nonNegative, amberMargin: nonNegative })
    .refine((v) => v.greenMargin <= v.amberMargin, {
      message: 'El margen verde no puede superar al ámbar',
      path: ['greenMargin'],
    }),
  k6: z
    .strictObject({
      greenMin: nonNegative,
      greenMax: nonNegative,
      amberMin: nonNegative,
      amberMax: nonNegative,
    })
    .refine(
      (v) => v.amberMin <= v.greenMin && v.greenMin <= v.greenMax && v.greenMax <= v.amberMax,
      {
        message:
          'La banda ámbar debe envolver a la verde (ámbar mín ≤ verde mín ≤ verde máx ≤ ámbar máx)',
        path: ['greenMin'],
      },
    ),
  k7: lowerBetter,
  k9: percentHigherBetter,
  k10: lowerBetter,
  k11: lowerBetter,
  k15: lowerBetter,
  k16: percentHigherBetter,
});
