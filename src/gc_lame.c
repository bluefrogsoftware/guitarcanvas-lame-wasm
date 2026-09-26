/*
 * Thin C wrapper around libmp3lame for the WebAssembly build used by
 * Guitar Canvas. Encodes stereo, planar, 32-bit float PCM in the range
 * +/-1.0 to constant-bitrate MPEG-1 Layer III frames, with no Xing/Info
 * VBR tag and no ID3 tag, so the output is a pure stream of CBR frames.
 */

#include <stdlib.h>

#include "lame.h"

/* Negative return codes surfaced to the JavaScript loader. Values below
 * -100 are wrapper-level errors; libmp3lame's own negative codes (see
 * lame.h) are passed through unchanged from encode/flush calls. */
#define GC_LAME_ERR_INIT (-101)
#define GC_LAME_ERR_PARAMS (-102)
#define GC_LAME_ERR_NULL_HANDLE (-103)

int gc_lame_interface_version(void)
{
    return 1;
}

lame_global_flags *gc_lame_open(int sample_rate, int bitrate_kbps)
{
    lame_global_flags *gfp = lame_init();
    if (gfp == NULL) {
        return NULL;
    }

    lame_set_in_samplerate(gfp, sample_rate);
    lame_set_num_channels(gfp, 2);
    lame_set_brate(gfp, bitrate_kbps);
    lame_set_VBR(gfp, vbr_off);
    lame_set_bWriteVbrTag(gfp, 0);
    lame_set_write_id3tag_automatic(gfp, 0);

    if (lame_init_params(gfp) < 0) {
        lame_close(gfp);
        return NULL;
    }

    return gfp;
}

int gc_lame_encode(lame_global_flags *gfp, const float *left, const float *right,
                    int frames, unsigned char *out, int capacity)
{
    if (gfp == NULL) {
        return GC_LAME_ERR_NULL_HANDLE;
    }

    return lame_encode_buffer_ieee_float(gfp, left, right, frames, out, capacity);
}

int gc_lame_flush(lame_global_flags *gfp, unsigned char *out, int capacity)
{
    if (gfp == NULL) {
        return GC_LAME_ERR_NULL_HANDLE;
    }

    int written = lame_encode_flush(gfp, out, capacity);
    lame_close(gfp);
    return written;
}
