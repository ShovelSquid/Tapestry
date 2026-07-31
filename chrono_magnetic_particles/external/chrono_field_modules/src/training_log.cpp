#include "living_field/training_log.hpp"
#include <fstream>
#include <iomanip>
namespace living_field { static std::string esc(const std::string&s){std::string o;for(char c:s){if(c=='"'||c=='\\')o+='\\';o+=c;}return o;}
bool append_jsonl(const std::string&p,const TrainingRecord&r){std::ofstream f(p,std::ios::app);if(!f)return false;f<<"{\"prompt\":\""<<esc(r.prompt)<<"\",\"goal_name\":\""<<esc(r.goal_name)<<"\",\"frequencies_hz\":[";for(size_t i=0;i<r.frequencies_hz.size();++i){if(i)f<<',';f<<std::setprecision(12)<<r.frequencies_hz[i];}f<<"],\"initial_error\":"<<r.initial_error<<",\"final_error\":"<<r.final_error<<",\"solver_ms\":"<<r.solver_ms<<",\"simulation_ms\":"<<r.simulation_ms<<",\"success\":"<<(r.success?"true":"false")<<"}\n";return true;}}
