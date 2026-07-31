#pragma once
#include "target_volume.hpp"
#include "spin_controller.hpp"
#include <functional>
#include <random>
namespace living_field {
struct FrequencySearch { double min_hz{0},max_hz{20}; int iterations{200},rollout_steps{300}; double dt{1.0/120.0}; std::uint32_t seed{7}; };
struct FrequencyResult { std::vector<double> frequencies_hz; double score{1e300}; int evaluations{}; };
using RolloutScore=std::function<double(const std::vector<double>&)>;
FrequencyResult random_search_frequencies(std::size_t node_count,const FrequencySearch&,const RolloutScore&);
}
