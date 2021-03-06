/******************************************************************************
 * Spine Runtimes Software License v2.5
 *
 * Copyright (c) 2013-2016, Esoteric Software
 * All rights reserved.
 *
 * You are granted a perpetual, non-exclusive, non-sublicensable, and
 * non-transferable license to use, install, execute, and perform the Spine
 * Runtimes software and derivative works solely for personal or internal
 * use. Without the written permission of Esoteric Software (see Section 2 of
 * the Spine Software License Agreement), you may not (a) modify, translate,
 * adapt, or develop new applications using the Spine Runtimes or otherwise
 * create derivative works or improvements of the Spine Runtimes or (b) remove,
 * delete, alter, or obscure any trademarks or any copyright, trademark, patent,
 * or other intellectual property or proprietary rights notices on or in the
 * Software, including any copy thereof. Redistributions in binary or source
 * form must include this license and terms.
 *
 * THIS SOFTWARE IS PROVIDED BY ESOTERIC SOFTWARE "AS IS" AND ANY EXPRESS OR
 * IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF
 * MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO
 * EVENT SHALL ESOTERIC SOFTWARE BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
 * SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
 * PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES, BUSINESS INTERRUPTION, OR LOSS OF
 * USE, DATA, OR PROFITS) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER
 * IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
 * ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
 * POSSIBILITY OF SUCH DAMAGE.
 *****************************************************************************/

module spine.webgl {
	class Renderable {
		constructor(public vertices: ArrayLike<number>, public numVertices: number, public numFloats: number) {}
	};

	export class SkeletonRenderer {
		static QUAD_TRIANGLES = [0, 1, 2, 2, 3, 0];

		premultipliedAlpha = false;
		private tempColor = new Color();
		private tempColor2 = new Color();
		private vertices:ArrayLike<number>;
		private vertexSize = 2 + 2 + 4;
		private twoColorTint = false;
		private renderable: Renderable = new Renderable(null, 0, 0);
		private clipper: SkeletonClipping = new SkeletonClipping();

		constructor (context: ManagedWebGLRenderingContext, twoColorTint: boolean = true) {
			this.twoColorTint = twoColorTint;
			if (twoColorTint)
				this.vertexSize += 4;
			this.vertices = Utils.newFloatArray(this.vertexSize * 1024);
		}

		draw (batcher: PolygonBatcher, skeleton: Skeleton) {
			let clipper = this.clipper;
			let premultipliedAlpha = this.premultipliedAlpha;
			let twoColorTint = this.twoColorTint;
			let blendMode: BlendMode = null;

			let renderable: Renderable = this.renderable;
			let uvs: ArrayLike<number> = null;
			let triangles: Array<number> = null;
			let drawOrder = skeleton.drawOrder;
			let attachmentColor: Color = null;
			let skeletonColor = skeleton.color;
			let vertexSize = twoColorTint ? 12 : 8;
			for (let i = 0, n = drawOrder.length; i < n; i++) {
				let clippedVertexSize = clipper.isClipping() ? 2 : vertexSize;
				let slot = drawOrder[i];
				let attachment = slot.getAttachment();
				let texture: GLTexture = null;
				if (attachment instanceof RegionAttachment) {
					let region = <RegionAttachment>attachment;
					renderable.vertices = this.vertices;
					renderable.numVertices = 4;
					renderable.numFloats = clippedVertexSize << 2;
					region.computeWorldVertices(slot.bone, renderable.vertices, 0, clippedVertexSize);
					triangles = SkeletonRenderer.QUAD_TRIANGLES;
					uvs = region.uvs;
					texture = <GLTexture>(<TextureAtlasRegion>region.region.renderObject).texture;
					attachmentColor = region.color;
				} else if (attachment instanceof MeshAttachment) {
					let mesh = <MeshAttachment>attachment;
					renderable.vertices = this.vertices;
					renderable.numVertices = (mesh.worldVerticesLength >> 1);
					renderable.numFloats = renderable.numVertices * clippedVertexSize;
					if (renderable.numFloats > renderable.vertices.length) {
						renderable.vertices = this.vertices = spine.Utils.newFloatArray(renderable.numFloats);
					}
					mesh.computeWorldVertices(slot, 0, mesh.worldVerticesLength, renderable.vertices, 0, clippedVertexSize);
					triangles = mesh.triangles;
					texture = <GLTexture>(<TextureAtlasRegion>mesh.region.renderObject).texture;
					uvs = mesh.uvs;
					attachmentColor = mesh.color;
				} else if (attachment instanceof ClippingAttachment) {
					let clip = <ClippingAttachment>(attachment);
					clipper.clipStart(slot, clip);
					continue;
				} else continue;

				if (texture != null) {
					let slotColor = slot.color;
					let finalColor = this.tempColor;
					finalColor.r = skeletonColor.r * slotColor.r * attachmentColor.r;
					finalColor.g = skeletonColor.g * slotColor.g * attachmentColor.g;
					finalColor.b = skeletonColor.b * slotColor.b * attachmentColor.b;
					finalColor.a = skeletonColor.a * slotColor.a * attachmentColor.a;
					if (premultipliedAlpha) {
						finalColor.r *= finalColor.a;
						finalColor.g *= finalColor.a;
						finalColor.b *= finalColor.a;
					}
					let darkColor = this.tempColor2;
					if (slot.darkColor == null) darkColor.set(0, 0, 0, 1);
					else darkColor.setFromColor(slot.darkColor);

					let slotBlendMode = slot.data.blendMode;
					if (slotBlendMode != blendMode) {
						blendMode = slotBlendMode;
						batcher.setBlendMode(WebGLBlendModeConverter.getSourceGLBlendMode(blendMode, premultipliedAlpha), WebGLBlendModeConverter.getDestGLBlendMode(blendMode));
					}

					if (clipper.isClipping()) {
						clipper.clipTriangles(renderable.vertices, renderable.numFloats, triangles, triangles.length, uvs, finalColor, darkColor, twoColorTint);
						let clippedVertices = new Float32Array(clipper.clippedVertices);
						let clippedTriangles = clipper.clippedTriangles;
						batcher.draw(texture, clippedVertices, clippedTriangles);
					} else {
						let verts = renderable.vertices;
						if (!twoColorTint) {
							for (let v = 2, u = 0, n = renderable.numFloats; v < n; v += vertexSize, u += 2) {
								verts[v] = finalColor.r;
								verts[v + 1] = finalColor.g;
								verts[v + 2] = finalColor.b;
								verts[v + 3] = finalColor.a;
								verts[v + 4] = uvs[u];
								verts[v + 5] = uvs[u + 1];
							}
						} else {
							for (let v = 2, u = 0, n = renderable.numFloats; v < n; v += vertexSize, u += 2) {
								verts[v] = finalColor.r;
								verts[v + 1] = finalColor.g;
								verts[v + 2] = finalColor.b;
								verts[v + 3] = finalColor.a;
								verts[v + 4] = uvs[u];
								verts[v + 5] = uvs[u + 1];
								verts[v + 6] = darkColor.r;
								verts[v + 7] = darkColor.g;
								verts[v + 8] = darkColor.b;
								verts[v + 9] = darkColor.a;
							}
						}
						let view = (renderable.vertices as Float32Array).subarray(0, renderable.numFloats);
						batcher.draw(texture, view, triangles);
					}
				}

				clipper.clipEndWithSlot(slot);
			}
			clipper.clipEnd();
		}
	}
}
