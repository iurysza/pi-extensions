// The axes frame in device px and its data -> device transform, through each axis' scale.
import { forward } from './scale.js';
                                                  

                       
                                                                                                                                 
                                                                                                                                         
                                                 
                                                                                                                                    
                                         
  
                     
                                                                
                                                                                                                     
                                                                                                                     
                      
                                                                                                 
                                                 
                                                                                                                   
                         
                                                                                     
                                                 
                                                                                                   
                                                                                     
  

/**
 * The axes bbox as matplotlib holds it: TransformedBbox(position, transFigure), so edges are
 * l·W, r·W, b·H, t·H in display (y-up) coordinates and widths are differences of edges.
 * Top-left y values flip with the canvas height, as Agg does.
 */
export function axesBox(p          , W        , H        , Hg         = H)          {
  const [l, b, r, t] = p;
  const x0 = l * W, x1 = r * W, y0 = b * H, y1 = t * H;
  return { x0, x1, yTop: H - y1, yBot: H - y0, yTopG: Hg - y1, yBotG: Hg - y0, w: x1 - x0, h: y1 - y0, b: y0, t: y1 };
}

/**
 * BboxTransformTo(axes.bbox) ∘ BboxTransformFrom(viewLim), composed by np.dot:
 * From = [1/w, −v0·(1/w)], so a = outw·(1/w), c = outw·(−v0·(1/w)) + outl. Points map as (v·a + 0) + c.
 */
export function frame(box         , W        , H        , dev        , xlim                           , ylim                           , xscale       , yscale       )        {
  const vx0 = forward(xscale, xlim[0]), vx1 = forward(xscale, xlim[1]), vy0 = forward(yscale, ylim[0]), vy1 = forward(yscale, ylim[1]);
  const kx = 1.0 / (vx1 - vx0), ky = 1.0 / (vy1 - vy0);
  const outb = box.b;
  return { box, W, H, Hg: geomHeight(H, dev), clipW: dev === 'agg' ? Math.trunc(W) : W, clipH: dev === 'agg' ? Math.trunc(H) : H, snap: dev === 'agg', xlim, ylim, xscale, yscale,
           ax: box.w * kx, cx: box.w * (-vx0 * kx) + box.x0,
           ay: box.h * ky, cy: box.h * (-vy0 * ky) + outb };
}
/**
 * The output a scene is laid out for. 'agg' is the PNG rasterizer (RendererAgg: int canvas, path snapping); 'svg' is
 * matplotlib's SVG backend (float canvas, no snapping).
 */
                                   
/** The height a device flips path geometry with: RendererAgg's int(height), or the float height in SVG. */
export const geomHeight = (H        , dev        )         => (dev === 'agg' ? Math.trunc(H) : H);

/** Data → top-left device px. */
export const tx = (f       , x        )         => forward(f.xscale, x) * f.ax + f.cx;
/** Data → top-left device px. Matches Agg's concatenated affine (scale(1,-1)·translate(0,H) after
 *  transData): y_out = −ay·v + (H − cy). Reassociating as H − (ay·v + cy) is 1 ulp off at some *.5 and
 *  disagrees with PathSnapper's floor(v+0.5). */
export const ty = (f       , y        )         => forward(f.yscale, y) * -f.ay + (f.Hg - f.cy);
/** Data → top-left px for a text anchor, which flips with the float height. */
export const tyText = (f       , y        )         => forward(f.yscale, y) * -f.ay + (f.H - f.cy);
