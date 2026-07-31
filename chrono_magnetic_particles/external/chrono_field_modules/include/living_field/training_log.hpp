#pragma once
#include <string>
#include <vector>
namespace living_field {
struct TrainingRecord { std::string prompt,goal_name; std::vector<double> frequencies_hz; double initial_error{},final_error{},solver_ms{},simulation_ms{}; bool success{}; };
bool append_jsonl(const std::string& path,const TrainingRecord& record);
}
