include(FetchContent)

if(SW_FETCH_CATCH2)
    FetchContent_Declare(Catch2
        GIT_REPOSITORY https://github.com/catchorg/Catch2.git
        GIT_TAG v3.8.1
        GIT_SHALLOW TRUE
        FIND_PACKAGE_ARGS 3 CONFIG)
    FetchContent_MakeAvailable(Catch2)
else()
    find_package(Catch2 3 REQUIRED CONFIG)
endif()

add_executable(sw_tests
    DeterminismTest.cpp
    ReplayTest.cpp
    SnapshotTest.cpp
    MaterialRuleTest.cpp)

target_link_libraries(sw_tests PRIVATE sw_core Catch2::Catch2WithMain)

if(DEFINED catch2_SOURCE_DIR)
    list(APPEND CMAKE_MODULE_PATH "${catch2_SOURCE_DIR}/extras")
else()
    list(APPEND CMAKE_MODULE_PATH "${Catch2_DIR}")
endif()

include(Catch)
catch_discover_tests(sw_tests)
