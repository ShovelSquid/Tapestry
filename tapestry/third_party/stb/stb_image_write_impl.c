/* Single translation unit that instantiates stb_image_write.
 *
 * Used only to dump the framebuffer to PNG for `tapestry --screenshot`, which
 * is how rendering gets verified without capturing the whole desktop. Nothing
 * on the normal draw path touches it. */

#define STB_IMAGE_WRITE_IMPLEMENTATION
#include "stb_image_write.h"
