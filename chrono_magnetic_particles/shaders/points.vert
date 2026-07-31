#version 430 core
layout(location=0) in vec4 aPosition;
uniform mat4 uViewProj;
uniform float uPointSize;
void main() {
    gl_Position = uViewProj * vec4(aPosition.xyz, 1.0);
    gl_PointSize = uPointSize;
}
