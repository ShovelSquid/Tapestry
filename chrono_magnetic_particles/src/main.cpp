#include <glad/gl.h>
#include <GLFW/glfw3.h>
#include <glm/glm.hpp>
#include <glm/gtc/matrix_transform.hpp>
#include <glm/gtc/quaternion.hpp>

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <fstream>
#include <iostream>
#include <random>
#include <sstream>
#include <stdexcept>
#include <string>
#include <vector>

struct alignas(16) Particle { glm::vec4 pos; glm::vec4 vel; };
struct alignas(16) GpuNode { glm::vec4 posRadius; glm::vec4 dipoleStrength; };
struct Node {
    glm::vec3 position{}, velocity{}, angularVelocity{};
    glm::quat orientation{1,0,0,0};
    float radius = 0.55f, mass = 4.0f, strength = 4.0f;
};

static std::string loadText(const std::string& path) {
    std::ifstream f(path, std::ios::binary);
    if (!f) throw std::runtime_error("Cannot open " + path);
    std::ostringstream ss; ss << f.rdbuf(); return ss.str();
}
static GLuint compile(GLenum type, const std::string& source) {
    GLuint s = glCreateShader(type); const char* p = source.c_str(); glShaderSource(s,1,&p,nullptr); glCompileShader(s);
    GLint ok=0; glGetShaderiv(s,GL_COMPILE_STATUS,&ok);
    if(!ok){ GLint n=0; glGetShaderiv(s,GL_INFO_LOG_LENGTH,&n); std::string log(n,'\0'); glGetShaderInfoLog(s,n,nullptr,log.data()); throw std::runtime_error(log); }
    return s;
}
static GLuint program(const std::vector<std::pair<GLenum,std::string>>& stages) {
    GLuint p=glCreateProgram(); std::vector<GLuint> shaders;
    for(auto& [t,path]:stages){ auto s=compile(t,loadText(path)); glAttachShader(p,s); shaders.push_back(s); }
    glLinkProgram(p); GLint ok=0; glGetProgramiv(p,GL_LINK_STATUS,&ok);
    if(!ok){ GLint n=0; glGetProgramiv(p,GL_INFO_LOG_LENGTH,&n); std::string log(n,'\0'); glGetProgramInfoLog(p,n,nullptr,log.data()); throw std::runtime_error(log); }
    for(auto s:shaders){ glDetachShader(p,s); glDeleteShader(s); } return p;
}

static glm::vec3 dipole(const Node& n){ return n.orientation * glm::vec3(0,0,1); }
static void integrateNodes(std::vector<Node>& nodes, float dt) {
    constexpr float soft=0.35f, forceScale=1.4f, torqueScale=1.0f;
    std::vector<glm::vec3> force(nodes.size(), glm::vec3(0)), torque(nodes.size(), glm::vec3(0));
    for(size_t i=0;i<nodes.size();++i) for(size_t j=i+1;j<nodes.size();++j){
        glm::vec3 r=nodes[j].position-nodes[i].position; float d2=glm::dot(r,r)+soft*soft; float d=std::sqrt(d2); glm::vec3 rh=r/d;
        glm::vec3 mi=dipole(nodes[i]), mj=dipole(nodes[j]);
        // Approximate dipole-dipole force and field torque; intentionally softened/game-stable.
        float inv4=1.0f/(d2*d2);
        glm::vec3 f=forceScale*nodes[i].strength*nodes[j].strength*inv4 *
          ((glm::dot(mi,rh))*mj + (glm::dot(mj,rh))*mi + glm::dot(mi,mj)*rh - 5.0f*glm::dot(mi,rh)*glm::dot(mj,rh)*rh);
        // rh points i->j, so the bracket above is the force on j; i takes the reaction.
        force[j]+=f; force[i]-=f;
        glm::vec3 Bi=nodes[j].strength*(3.0f*rh*glm::dot(mj,rh)-mj)/(d2*d);
        glm::vec3 Bj=nodes[i].strength*(3.0f*(-rh)*glm::dot(mi,-rh)-mi)/(d2*d);
        torque[i]+=torqueScale*glm::cross(mi,Bi); torque[j]+=torqueScale*glm::cross(mj,Bj);
        float minD=nodes[i].radius+nodes[j].radius;
        if(d<minD){ glm::vec3 repel=-rh*(minD-d)*45.0f; force[i]+=repel; force[j]-=repel; }
    }
    for(size_t i=0;i<nodes.size();++i){
        auto& n=nodes[i]; n.velocity += (force[i]/n.mass)*dt; n.velocity*=std::exp(-0.35f*dt); n.position+=n.velocity*dt;
        float inertia=0.4f*n.mass*n.radius*n.radius; n.angularVelocity+=(torque[i]/inertia)*dt; n.angularVelocity*=std::exp(-0.22f*dt);
        glm::quat w(0,n.angularVelocity.x,n.angularVelocity.y,n.angularVelocity.z); n.orientation=glm::normalize(n.orientation + 0.5f*dt*w*n.orientation);
        for(int a=0;a<3;++a) if(std::abs(n.position[a])>7.0f){ n.position[a]=glm::clamp(n.position[a],-7.0f,7.0f); n.velocity[a]*=-0.7f; }
    }
}

int main(){
    try {
        if(!glfwInit()) throw std::runtime_error("glfwInit failed");
        glfwWindowHint(GLFW_CONTEXT_VERSION_MAJOR,4); glfwWindowHint(GLFW_CONTEXT_VERSION_MINOR,3); glfwWindowHint(GLFW_OPENGL_PROFILE,GLFW_OPENGL_CORE_PROFILE);
        GLFWwindow* win=glfwCreateWindow(1280,800,"Adaptive Magnetic Particle Field",nullptr,nullptr);
        if(!win) throw std::runtime_error("OpenGL 4.3 window creation failed");
        glfwMakeContextCurrent(win); glfwSwapInterval(1);
        if(!gladLoadGL(glfwGetProcAddress)) throw std::runtime_error("GLAD failed");
        std::cout << "GPU: " << glGetString(GL_RENDERER) << "\nOpenGL: " << glGetString(GL_VERSION) << '\n';

        GLint64 maxSsbo=0; glGetInteger64v(GL_MAX_SHADER_STORAGE_BLOCK_SIZE,&maxSsbo);
        const uint32_t hardCap=4'000'000;
        uint32_t capacity=std::min<uint64_t>(hardCap, std::max<int64_t>(32768, maxSsbo/(sizeof(Particle)*2)));
        uint32_t active=std::min<uint32_t>(capacity, 250'000);
        std::cout << "Particle capacity: " << capacity << ", initial active: " << active << '\n';

        std::mt19937 rng(7); std::uniform_real_distribution<float> u(-1,1);
        std::vector<Particle> particles(capacity);
        for(auto& p:particles){ glm::vec3 x(u(rng),u(rng),u(rng)); x*=7.0f; p.pos=glm::vec4(x,1); p.vel=glm::vec4(0.15f*u(rng),0.15f*u(rng),0.15f*u(rng),0); }
        std::vector<Node> nodes={
          {{-2.5f,0,0},{0,0.2f,0},{0,0,5.5f},glm::angleAxis(0.8f,glm::normalize(glm::vec3(0.2f,1,0.1f))),0.62f,5,5.0f},
          {{ 2.5f,0,0},{0,-0.2f,0},{0,0,-4.5f},glm::angleAxis(-0.6f,glm::normalize(glm::vec3(1,0.3f,0.1f))),0.62f,5,5.0f},
          {{0,2.8f,0},{-0.15f,0,0},{3.5f,0,0},glm::angleAxis(1.2f,glm::normalize(glm::vec3(0.3f,0.2f,1))),0.50f,3,3.8f}
        };

        GLuint particleBuf,nodeBuf,nodePosBuf,vao; glGenBuffers(1,&particleBuf); glBindBuffer(GL_SHADER_STORAGE_BUFFER,particleBuf); glBufferData(GL_SHADER_STORAGE_BUFFER,particles.size()*sizeof(Particle),particles.data(),GL_DYNAMIC_DRAW);
        glGenBuffers(1,&nodeBuf); glBindBuffer(GL_SHADER_STORAGE_BUFFER,nodeBuf); glBufferData(GL_SHADER_STORAGE_BUFFER,nodes.size()*sizeof(GpuNode),nullptr,GL_DYNAMIC_DRAW);
        glGenBuffers(1,&nodePosBuf); glBindBuffer(GL_ARRAY_BUFFER,nodePosBuf); glBufferData(GL_ARRAY_BUFFER,nodes.size()*sizeof(glm::vec4),nullptr,GL_DYNAMIC_DRAW);
        glGenVertexArrays(1,&vao); glBindVertexArray(vao); glBindBuffer(GL_ARRAY_BUFFER,particleBuf); glEnableVertexAttribArray(0); glVertexAttribPointer(0,4,GL_FLOAT,GL_FALSE,sizeof(Particle),(void*)0);

        const std::string sd=SHADER_DIR;
        GLuint compute=program({{GL_COMPUTE_SHADER,sd+"/particles.comp"}});
        GLuint draw=program({{GL_VERTEX_SHADER,sd+"/points.vert"},{GL_FRAGMENT_SHADER,sd+"/points.frag"}});
        glEnable(GL_PROGRAM_POINT_SIZE); glEnable(GL_BLEND); glBlendFunc(GL_SRC_ALPHA,GL_ONE_MINUS_SRC_ALPHA); glEnable(GL_DEPTH_TEST);

        auto prev=std::chrono::steady_clock::now(); double tuneClock=0; int tuneFrames=0;
        while(!glfwWindowShouldClose(win)){
            glfwPollEvents(); auto now=std::chrono::steady_clock::now(); float dt=std::min(0.025f,std::chrono::duration<float>(now-prev).count()); prev=now;
            if(glfwGetKey(win,GLFW_KEY_ESCAPE)==GLFW_PRESS) glfwSetWindowShouldClose(win,1);
            integrateNodes(nodes,dt);
            std::vector<GpuNode> gpuNodes; std::vector<glm::vec4> nodePos;
            for(auto& n:nodes){ gpuNodes.push_back({glm::vec4(n.position,n.radius),glm::vec4(dipole(n),n.strength)}); nodePos.push_back(glm::vec4(n.position,1)); }
            glBindBuffer(GL_SHADER_STORAGE_BUFFER,nodeBuf); glBufferSubData(GL_SHADER_STORAGE_BUFFER,0,gpuNodes.size()*sizeof(GpuNode),gpuNodes.data());
            glBindBuffer(GL_ARRAY_BUFFER,nodePosBuf); glBufferSubData(GL_ARRAY_BUFFER,0,nodePos.size()*sizeof(glm::vec4),nodePos.data());

            glUseProgram(compute); glBindBufferBase(GL_SHADER_STORAGE_BUFFER,0,particleBuf); glBindBufferBase(GL_SHADER_STORAGE_BUFFER,1,nodeBuf);
            glUniform1ui(glGetUniformLocation(compute,"uParticleCount"),active); glUniform1ui(glGetUniformLocation(compute,"uNodeCount"),(GLuint)nodes.size());
            glUniform1f(glGetUniformLocation(compute,"uDt"),dt); glUniform1f(glGetUniformLocation(compute,"uBounds"),7.5f); glUniform1f(glGetUniformLocation(compute,"uDrag"),0.08f);
            glDispatchCompute((active+255)/256,1,1); glMemoryBarrier(GL_SHADER_STORAGE_BARRIER_BIT|GL_VERTEX_ATTRIB_ARRAY_BARRIER_BIT);

            int w,h; glfwGetFramebufferSize(win,&w,&h); glViewport(0,0,w,h); glClearColor(0.008f,0.012f,0.025f,1); glClear(GL_COLOR_BUFFER_BIT|GL_DEPTH_BUFFER_BIT);
            float t=(float)glfwGetTime(); glm::vec3 eye=glm::vec3(std::sin(t*0.08f)*15.0f,7.5f,std::cos(t*0.08f)*15.0f);
            glm::mat4 vp=glm::perspective(glm::radians(52.0f),(float)w/std::max(1,h),0.1f,80.0f)*glm::lookAt(eye,glm::vec3(0),glm::vec3(0,1,0));
            glUseProgram(draw); glUniformMatrix4fv(glGetUniformLocation(draw,"uViewProj"),1,GL_FALSE,&vp[0][0]);
            glUniform3f(glGetUniformLocation(draw,"uColor"),0.25f,0.72f,1.0f); glUniform1f(glGetUniformLocation(draw,"uPointSize"),2.0f);
            glBindVertexArray(vao); glBindBuffer(GL_ARRAY_BUFFER,particleBuf); glVertexAttribPointer(0,4,GL_FLOAT,GL_FALSE,sizeof(Particle),(void*)0); glDrawArrays(GL_POINTS,0,active);
            glBindBuffer(GL_ARRAY_BUFFER,nodePosBuf); glVertexAttribPointer(0,4,GL_FLOAT,GL_FALSE,sizeof(glm::vec4),(void*)0); glUniform3f(glGetUniformLocation(draw,"uColor"),1.0f,0.45f,0.12f); glUniform1f(glGetUniformLocation(draw,"uPointSize"),34.0f); glDrawArrays(GL_POINTS,0,(GLsizei)nodes.size());
            glfwSwapBuffers(win);

            tuneClock += dt; ++tuneFrames;
            if(tuneClock>1.5){ double fps=tuneFrames/tuneClock; uint32_t old=active; if(fps>72 && active<capacity) active=std::min(capacity,(uint32_t)(active*1.35)); else if(fps<48 && active>32768) active=std::max(32768u,(uint32_t)(active*0.78));
                if(old!=active) std::cout<<"Auto-tune: "<<active<<" particles ("<<(int)fps<<" FPS)\n"; tuneClock=0; tuneFrames=0; }
        }
        glDeleteProgram(compute); glDeleteProgram(draw); glDeleteBuffers(1,&particleBuf); glDeleteBuffers(1,&nodeBuf); glDeleteBuffers(1,&nodePosBuf); glDeleteVertexArrays(1,&vao);
        glfwDestroyWindow(win); glfwTerminate();
    } catch(const std::exception& e){ std::cerr<<"Fatal: "<<e.what()<<'\n'; glfwTerminate(); return 1; }
}
