class WebGLManager {
    constructor() {
        this.gl = null;
        this.program = null;
        this.texture = null;
        this.positionBuffer = null;
        this.texCoordBuffer = null;
        this.canvas = null;
    }

    init(canvas) {
        this.canvas = canvas;
        this.gl = canvas.getContext('webgl', { preserveDrawingBuffer: true });
        if (!this.gl) {
            console.error("WebGL not supported");
            return false;
        }

        const vsSource = `
            attribute vec2 a_position;
            attribute vec2 a_texCoord;
            varying vec2 v_texCoord;
            uniform vec4 u_crop; // x, y, w, h

            void main() {
                gl_Position = vec4(a_position, 0.0, 1.0);
                // Transform texCoord based on crop
                // a_texCoord is 0..1. We want to map it to crop.x .. crop.x + crop.w
                // But we also need to handle Y flipping if necessary.
                // Assuming input a_texCoord is standard 0..1 (0=Top, 1=Bottom for video?)
                // Let's assume standard mapping first and adjust.
                
                vec2 t = a_texCoord * u_crop.zw + u_crop.xy;
                v_texCoord = t;
            }
        `;

        const fsSource = `
            precision mediump float;
            varying vec2 v_texCoord;
            uniform sampler2D u_texture;
            uniform int u_filterType; // 0: Standard, 1: Yellow Boost
            uniform float u_threshold;
            uniform float u_contrast;

            void main() {
                vec4 color = texture2D(u_texture, v_texCoord);
                float r = color.r * 255.0;
                float g = color.g * 255.0;
                float b = color.b * 255.0;

                float val = 0.0;

                if (u_filterType == 1) {
                    // Yellow Boost
                    // Logic: (r + g) / 2 - b > 40
                    float yellowScore = (r + g) / 2.0 - b;
                    val = (yellowScore > 40.0) ? 1.0 : 0.0;
                } else {
                    // Standard Filter
                    // Grayscale
                    float gray = (r + g + b) / 3.0;
                    
                    // Contrast
                    if (u_contrast != 0.0) {
                        float f = (259.0 * (u_contrast + 255.0)) / (255.0 * (259.0 - u_contrast));
                        gray = f * (gray - 128.0) + 128.0;
                    }

                    // Threshold
                    val = (gray > u_threshold) ? 1.0 : 0.0;
                }

                gl_FragColor = vec4(val, val, val, 1.0);
            }
        `;

        this.program = this.createProgram(this.gl, vsSource, fsSource);
        if (!this.program) return false;

        this.gl.useProgram(this.program);

        // Look up locations
        this.positionLocation = this.gl.getAttribLocation(this.program, "a_position");
        this.texCoordLocation = this.gl.getAttribLocation(this.program, "a_texCoord");
        this.textureLocation = this.gl.getUniformLocation(this.program, "u_texture");
        this.filterTypeLocation = this.gl.getUniformLocation(this.program, "u_filterType");
        this.thresholdLocation = this.gl.getUniformLocation(this.program, "u_threshold");
        this.contrastLocation = this.gl.getUniformLocation(this.program, "u_contrast");
        this.cropLocation = this.gl.getUniformLocation(this.program, "u_crop");

        // Create buffers
        this.positionBuffer = this.gl.createBuffer();
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.positionBuffer);
        // Two triangles covering the clip space
        this.gl.bufferData(this.gl.ARRAY_BUFFER, new Float32Array([
            -1.0, -1.0,
            1.0, -1.0,
            -1.0, 1.0,
            -1.0, 1.0,
            1.0, -1.0,
            1.0, 1.0,
        ]), this.gl.STATIC_DRAW);

        this.texCoordBuffer = this.gl.createBuffer();
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.texCoordBuffer);
        // Standard UVs: (0,0) top-left, (1,1) bottom-right for video textures usually?
        // Let's try standard 0..1
        this.gl.bufferData(this.gl.ARRAY_BUFFER, new Float32Array([
            0.0, 1.0,
            1.0, 1.0,
            0.0, 0.0,
            0.0, 0.0,
            1.0, 1.0,
            1.0, 0.0,
        ]), this.gl.STATIC_DRAW);

        // Create texture
        this.texture = this.gl.createTexture();
        this.gl.bindTexture(this.gl.TEXTURE_2D, this.texture);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.LINEAR);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.LINEAR);

        return true;
    }

    createProgram(gl, vsSource, fsSource) {
        const vs = this.compileShader(gl, gl.VERTEX_SHADER, vsSource);
        const fs = this.compileShader(gl, gl.FRAGMENT_SHADER, fsSource);
        if (!vs || !fs) return null;

        const program = gl.createProgram();
        gl.attachShader(program, vs);
        gl.attachShader(program, fs);
        gl.linkProgram(program);

        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            console.error("Program link error:", gl.getProgramInfoLog(program));
            return null;
        }
        return program;
    }

    compileShader(gl, type, source) {
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            console.error("Shader compile error:", gl.getShaderInfoLog(shader));
            gl.deleteShader(shader);
            return null;
        }
        return shader;
    }

    updateTexture(source) {
        if (!this.gl) return;
        this.gl.bindTexture(this.gl.TEXTURE_2D, this.texture);
        this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGBA, this.gl.RGBA, this.gl.UNSIGNED_BYTE, source);
    }

    applyFilter(phase, isGameActive, crop) {
        if (!this.gl) return;

        this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
        this.gl.clear(this.gl.COLOR_BUFFER_BIT);

        this.gl.useProgram(this.program);

        // Setup attributes
        this.gl.enableVertexAttribArray(this.positionLocation);
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.positionBuffer);
        this.gl.vertexAttribPointer(this.positionLocation, 2, this.gl.FLOAT, false, 0, 0);

        this.gl.enableVertexAttribArray(this.texCoordLocation);
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.texCoordBuffer);
        this.gl.vertexAttribPointer(this.texCoordLocation, 2, this.gl.FLOAT, false, 0, 0);

        // Setup uniforms
        if (phase === "TURN") {
            // Yellow Boost
            this.gl.uniform1i(this.filterTypeLocation, 1);
        } else {
            // Standard
            this.gl.uniform1i(this.filterTypeLocation, 0);
            let th = isGameActive ? 172.0 : 72.0;
            let cont = isGameActive ? 0.0 : 105.0;
            this.gl.uniform1f(this.thresholdLocation, th);
            this.gl.uniform1f(this.contrastLocation, cont);
        }

        // Set Crop
        if (crop) {
            this.gl.uniform4f(this.cropLocation, crop.x, crop.y, crop.w, crop.h);
        } else {
            this.gl.uniform4f(this.cropLocation, 0.0, 0.0, 1.0, 1.0);
        }

        // Draw
        this.gl.drawArrays(this.gl.TRIANGLES, 0, 6);
    }

    getCanvas() {
        return this.canvas;
    }
}
