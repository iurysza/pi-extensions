// The domain model. Every composite type is a product of small unions whose
// state count equals the number of meaningful states — no sentinel strings
// ('None'), no optional fields, no `undefined`. Absence is a variant.
//
// Design check (naive product -> meaningful):
//   AxisSpec   numeric(2 scales × 2 × 2) + category(2 × 2) + datetime(2 × 2) = 16 of 16
//   Ink        fill | stroke | fillStroke                                = 3 of 3   (invisible is not a node)
//   Placement  horizontal(3 ha × 5 va) + ylabel + ylabelRight            = 17 of 17
//   LineArtist stroke(none|on) × markers(none|on) × label(none|text)     = 8 of 8   (none×none still autoscales)
//   LegendLoc  best | anchored(1..10)                                    = 11 of 11
//   Limits     auto | fixed(lo, hi)                                      = 2 of 2

// ---------------------------------------------------------------- algebra
                                                                                                 
                                                                                                                  

export const none                            = { kind: 'none' };
export const some =    (value   )            => ({ kind: 'some', value });
export const ok =    (value   )            => ({ ok: true, value });
export const err =    (error        )            => ({ ok: false, error });

/** The imperative shell's boundary: a Result becomes a value or an exception. */
export const unwrap =    (r           )    => {
  if (r.ok) return r.value;
  throw new Error(r.error);
};

/** Exhaustiveness: unreachable when a switch handles every variant. */
export function assertNever(x       )        {
  throw new Error(`unhandled variant: ${JSON.stringify(x)}`);
}

// ---------------------------------------------------------------- color & ink
/** A parsed color. alpha ∈ [0, 1]. */
                                                                   
/** A color slot that may be empty ('none' in matplotlib). */
                                                                                                

                                              
                                               
/** Dash pattern in device px. */
                                                                                                                                          
/** A visible stroke: width > 0 px. */
                                                                                                                                  
/** What a closed shape draws. The fourth state (neither) is not a node at all. */
                 
                                                 
                                                        
                                                                                 

// ---------------------------------------------------------------- scene
                 
                                  
                                  
                                                  
                                                                  
                   
/** Text glyph rotation: axis-aligned, or arbitrary degrees CCW (matplotlib Text.rotation). */
                                                                                                     
/** A positioned glyph: a font glyph key (character or ligature) and its offset along the baseline in px. */
                                                                  
                                                                                                                                                         

                                                                                                                                  
/** Renderer-independent output of layout, in device px, top-left origin, laid out for one device (frame.ts Device: Agg snapping applied for PNG, none for SVG). */
                  
                                                                                                                                
            
                                                                                                                   
                                                                                                                                             
                                                                                                                                         
                                                                                                                                                                  
                                                                                                                  
                                                                        
                                                                                                                                         
     
                                                                                            
                                                                                                                                         
                                                                                                                      
                                                                                                            
     
                                                                                                                                                
                                                                                          
                                                                                                                     
                                                                                                           

/** dpi is carried for renderers that size fonts like FreeType (points × dpi, in 26.6). */
                                                                                                                                                           

// ---------------------------------------------------------------- tick labels
/**
 * What a tick label says. 'power' is matplotlib's mathtext `$\mathdefault{[c\times]b^{e}}$`
 * (LogFormatterSciNotation); it is laid out by the mathtext model in text.ts.
 */
                       
                                                     
                                                                                                                 

// ---------------------------------------------------------------- text placement
                                                 
                                                                                  
/** Text placement: horizontal, 90° ylabel, or arbitrary-angle (rotation_mode='default'). */
                       
                                                                             
                                                                                
                                                                                     
                                                                                    
                                                                           
                                                                                 
                                                                                                

// ---------------------------------------------------------------- artists
                                                                                                                                  
                                                                                                     
                                                                         
                                                                      
/**
 * A linestyle: a named one, or an (offset, on-off sequence) dash tuple in pt before lines.scale_dashes. `onoff`
 * none is a None or empty sequence: drawn solid, though Line2D still counts it dashed (dash cap and join).
 */
                                                                                                                                        
                                                                                                 

                                                                                                                                                       
                         
                             
                                                                                                                                                           
                                                                                                                         
                                                    

/** Line2D.set_drawstyle: how consecutive points connect (cbook.pts_to_{pre,mid,post}step). */
                                                                             
/** Which coordinate system each of a line's coordinates is in: axhline is (axes, data), axvline (data, axes).
 *  Only data coordinates update the data limits. */
                                                                                      
/**
 * plot(…, { decimate }), not a matplotlib option: before path cleanup, keep only the first and last sample of every
 * device-pixel column (perPx columns per pixel), its lowest and highest with their neighbours, and both ends of every
 * step over DECIMATE_STEP_PX, in their original order (decimateMinMax in path.ts). Off by default, so output
 * stays matplotlib's. Applies to a stroke whose x is non-decreasing; markers and legend placement see every sample.
 */
                                                                                                      
                          
                                                                            
                                                                                    
                                                                                                                  
                                                                                      
                          
                                                                                                        
                            
  
/** axline: an infinite straight line through p1 and p2, or through p1 with a slope (linear scales only),
 *  clipped to the view limits at draw time (lines.AxLine.get_transform). */
                                                                                                                                                      
                            
                                                                                                     
                                                                             
  
/** A LineCollection of straight segments (hlines, vlines, errorbar bars). Colours and line styles cycle
 *  over the segments; `zorder` is 2 (LineCollection's default). */
                              
                                                                                                                                        
                                                                                                   
                                                                         
  
/** A Polygon patch (hist's step and stepfilled outlines): closed or open, filled or not.
 *  `stickyBase` is appended to sticky_edges on that axis (hist uses y=0 / x=0); none = no sticky. */
                             
                                                                                                         
                                                                                                                       
                                                                                    
                                                                                                    
                                
  
/** The look of an errorbar's legend entry (HandlerErrorbar): the data line (absent for fmt='none'), the bar
 *  lines, and the first cap line's marker style (absent without caps or limit markers). */
                              
                                                                                        
                                                                                             
                                                                                                                               
                                                 
  
/** ErrorbarContainer: draws nothing itself (its lines are separate artists); it carries the legend entry. */
                                                                                                                                           
/** Rects in data coords; (x, y) is the corner at the base. The base axis is y for vertical bars (sticky edges). */
                         
                                                          
                                                                                                         
                                                                                             
                                                                                                        
                         
                                                                                               
                           
                                                                                               
                                         
  
/** fill_between: the polygon start → (x, y1)… → end → (x, y2) reversed. `color=` paints the edge too (Collection.set_color). */
                          
                                                                                                        
                                                                                              
  
/** Where a text artist's (x, y) lives: data coordinates or axes fractions (transAxes). */
                                         
                          
                                                                                                                    
                                                                                                                  
                         
                                                                                                         
                            
  
/** Scatter: a PathCollection of identical markers at (x, y), size in pt^2 (matplotlib semantics). */
                             
                                                                               
                                                                                                          
                                         
                                                           
                          
                                                                                     
                                                                                                                                              
  
/** Axes aspect: 'auto' (default) or a fixed data aspect ratio ('equal' → 1), with adjustable='box'. */
                                                                                                                                 
/** A PathCollection's sizes (pt^2) and colours as given (get_sizes, get_facecolor, get_edgecolor): one each, or one
 *  per point, cycled over the points. Not broadcast, because the draw path and the legend handler depend on the
 *  lengths, and an empty scatter (a legend proxy) still has them. */
                                                                                                                                        
/**
 * An annotation coordinate system (_AnnotationBase._get_xy_transform): 'data', or "<ref> <unit>"
 * where ref is figure | axes | offset (offset: from the annotated point; textcoords only) and
 * unit is points | pixels | fontsize | fraction (fraction: figure and axes only).
 */
                                                         
                                                                           
                                                                                                                                                     
/** xycoords / textcoords per axis: a string sets both (pair false); a (x, y) tuple sets each, as
 *  blended_transform_factory. Only the string 'data' hides an annotation whose xy leaves the axes (_check_xy). */
                                                                                                                         
/** One end of an ArrowStyle._Curve: nothing, an open head ('<', '>'), a filled head ('<|', '|>'), or a bracket (']', '[', '|'). */
                                                              
/** The ArrowStyle classes annotate draws, with their parameters (fractions of the mutation scale). */
                        
     
                                                                                                    
                                                            
                                                                                                         
                                                           
                                                                     
   
                                                                                                                    
                                                                                                                   
                                                                                          
/**
 * annotate's arrowprops. Without an 'arrowstyle' matplotlib simulates the YAArrow (ArrowStyle.Simple sized by
 * width / headwidth / headlength in pt, shrink a fraction); with one it is a FancyArrowPatch of that style along
 * ConnectionStyle.Arc3(rad), starting at relpos of the text box, shrunk by shrinkA / shrinkB pt.
 */
                             
     
                                                                                                       
                                                                                                                   
   
     
                                                                                                      
                                                                                                 
                                                           
                                                                   
                                        
    
                                
                              
                                                                                 
                                                                                     
                                                                                                                                         
                                                                             
                                          
                         
  
/** axvspan/axhspan bands: oriented spans that may use axes-fraction extents on the non-data axis. */
                          
                                                           
                                                                             
                                           
                                                               
                                           
                                                                                              
  
/** imshow: ScalarMappable raster over an extent in data coordinates. */
                           
                         
                                                                                                     
                                                                              
                               
                                                                                                               
                                                             
                                     
                                                                                               
                                                                                                 
  
/** Invisible extent + sticky edges (boxplot manage_ticks pads positions by ±0.5). Draws nothing. */
                            
                          
                                 
                                 
                        
                         
  
/**
 * A Wedge patch (Axes.pie): Path.arc(theta1, theta2) (degrees) scaled by r about (cx, cy), closed through the centre,
 * or the ring between r − width and r. `shift` makes it a patches.Shadow of that wedge: its path moves by
 * (ox, oy)·dpi/72 in data units (Shadow._update_transform's translation, composed before transData).
 */
                           
                                                                                       
                                                                                   
                                                                                                                       
                                                                           
  
                                                                                                                     
                                                                                                              

/** What a legend entry draws. */
                    
                                                                                         
                                                                            
                                                                    
                                                                                                       
                                            
                                                                                                             
                                                                                                                  
                                                                                                                                   
                                                                              

// ---------------------------------------------------------------- axes
                                                                                                  
/**
 * auto: autoscale at draw (a request is pending); fixed: set_xlim, autoscaling off; view: autoscaling on but
 * no request since the view was last computed (matplotlib's viewLim when not stale), e.g. (0, 1) on an Axes
 * nothing has asked to autoscale, or the limits axhline read before adding a line inside them.
 */
/** auto: autoscaled from the data; `inverted` keeps an inverted axis inverted (set_bound sorts high to low). */
                                                                                                                                                                                                                        
                                                                                                                
                                                                                                                   
/** 'auto' ticks/labels mean "what matplotlib's converter picks for this kind of axis". */
/** Date-axis major formatter: AutoDateFormatter (default) or ConciseDateFormatter / DateFormatter. */
                               
                             
                                                       
     
                               
                                                  
                                                      
                                                        
                                   
      

/** A dateutil rrule as matplotlib's RRuleLocator subclasses build it: every by-list explicit (a full range means any). */
                         
                                                                          
                            
                                                                              
                                                                                                                 
  
/** Date-axis major locator: AutoDateLocator (default), an RRuleLocator (Month/Day/Hour/Minute/SecondLocator) or YearLocator. */
                             
                             
                                                        
                                                                                                   
/** Spine.set_position: 'outward' pts from the axes edge (negative is inward), at an axes fraction, or at a data
 *  value ('center' is ('axes', 0.5), 'zero' is ('data', 0)). */
                                                                                                                                                                                 

                      
                                                                                                                                      
                                                                                                                                                   
                                                                               
                                                                                                                                                                                           

                                           
/** Text properties set on one major tick label (set_xticklabels kwargs, get_xticklabels()[i].set_*). */
/** Per-tick Text styling. rotation is degrees CCW (matplotlib); unsupported keys throw at set time. */
                              
                              
                                  
                                  
                                    
                              
                                    
  
/** [major tick index, style] pairs (a list, so the spec stays JSON for the layout cache); an index
 *  with no entry uses the tick theme. */
                                                                             
                                                                                                     
/** One family of gridlines (Line2D properties). `style` none is linestyle 'none': nothing drawn.
 *  `alpha` replaces the colour's alpha, as Line2D.set_alpha does (grid.alpha is passed as alpha). */
                                                                                                                                     
/** Axis.grid state for one tick family: shown or not, and the line properties it keeps either way. */
                                                                           
                                                                              
                                                                      
                                                                
                                                                                                             
                        
                            
                                                                                                                                                                    
/** Legend marker settings: scatterpoints and scatteryoffsets (HandlerPathCollection), markerscale (every handler's markers). */
                                                                                                                                          

/** A twinx Axes shares its host's x axis; its y axis, label and offset text live on the right. */
                                                                                                                                                                                                                                                     

/** One of an Axes' three titles (matplotlib's _left_title, title, _right_title); '' draws nothing. y is the
 *  baseline's height in axes fractions (1: the top), before the shared pad. */
                                                                                                                                             
/** set_title's three slots, each its own Text, and the pad (points) every one of them is offset by. */
                                                                                                                                     
/** axes.titlecolor: 'auto' leaves a title's colour as it was (text.color at first); a colour resets it on every set_title. */
                                                                                

/** Fractions of the figure: left, bottom, right, top. */
                                                                 
                        
                                                                                            
                                                                                
                                                                                                   
                                                        
                          
                                                                                
                                     
                                                                                                             
                                             
                                                                                           
                                                                                            
                                                                                      
                    
                                                                                                                                                          
                                                                                                                                                           
                                                                                                                                                         
                                                                                                                                                            
    
                                                                  
                                                                                    
                                                                                                    
                                                   
                                                                                                     
                                                                      
                                                                                                     
                            
  
                          
                                                                                                                                       
                                                                                                                                                                                                                  
                                                                                                                                                                                                                
                                                                                                                                                                                                            
                                                                                                                                                                                                            
  

// ---------------------------------------------------------------- theme (parsed rcParams)
                                                   
                                                   
                         
                                                                                                          
                                                                                           
                                                                                   
                                     
                                                                             
  
                                                                                                        

                     
                                                                                                                                                       
                                         
                                                                           
                                                                                                                             
                                                                                     
                                                                                                                             
                                                                                                                                                                                     
                                         
                                                                                                                       
                                      
                  
                                                                           
                                                                                                                          
                                                           
                                                                                        
                                                                                                                          
                                                       
                                                                                                                                      
                                   
                                   
    
                   
                                                                                                     
                                                                      
                                                                                          
                                                                           
                                                                                                     
                                                                                                                                       
                                  
                                                                                                   
                        
    
                              
                                                                                                    
                                                                                                                      
                            
                            
                    
                                                                                                                                                   
                                                          
                                                                                                                            
                                                                                                   
                                                                 
    
                                   
                                                                                                       
                                                                                                                                
                                                    
                                                                                         
                                                                                                      
                                                                                                                            
                                                                          
                     
                              
                            
                                  
                                
                               
                              
                                 
                               
                                
                                    
                                
                                   
                                 
                                   
    
  
/** boxplot.whiskers: a float (IQR multiple) or a percentile pair. */
                                                                                                                                                  
                             
                                                                               
  
                                             
                                                                                                                 
  
                              
                                                                                       
                                                                                    
                                                                    
  

// ---------------------------------------------------------------- layout output
                        
                                                                                                                                          
                                                                             
  
                                                                                                                                           
/** The data → device mapping layout used for this axes (see core/frame.ts): what an interactive layer inverts. */
                         
                                                                                                           
                                                                                     
                                                                     
  
/** A device-space box, px, y down. */
                                                                                                           
/** Axes.get_tightbbox(for_layout_only=True), px y down: what tight_layout fits into the figure. */
/** A tight bbox in px y down, plus its bottom and top edges in display (y-up) coordinates as matplotlib computes
 *  them (H − y1 can be an ulp off, which moves tight_layout's subplot params). */
                                                                          
                                                                                                                                                                
