#version 430 core
out vec4 FragColor;
uniform vec3 uColor;
void main() {
    vec2 q = gl_PointCoord * 2.0 - 1.0;
    float r2 = dot(q,q);
    if (r2 > 1.0) discard;
    float alpha = smoothstep(1.0, 0.65, r2);
    FragColor = vec4(uColor, alpha);
}
