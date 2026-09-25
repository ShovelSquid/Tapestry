# two_process.cmake — the SIM-02 two-process golden check, run by CTest as
#   cmake -DREPLAY=<ms_replay> -DACTIONS=<fixture.actions>
#         -DEXPECTED=<fixture.sha256> -DWORK=<dir> -P two_process.cmake
#
# Runs the replay CLI twice as separate processes (fresh ASLR, fresh
# allocator state), requires both outputs to be identical and equal to the
# committed golden byte for byte, then runs once more with --roundtrip
# --compare so serialize/restore into a second sim is checked at every
# checkpoint by a third process. Any difference is a FATAL_ERROR, which
# CTest reports as a failed test.
foreach(v REPLAY ACTIONS EXPECTED WORK)
    if(NOT DEFINED ${v})
        message(FATAL_ERROR "two_process.cmake: ${v} is not set")
    endif()
endforeach()
if(NOT EXISTS "${EXPECTED}")
    message(FATAL_ERROR
        "two_process.cmake: missing golden ${EXPECTED}; produce it deliberately with "
        "`ms_replay ${ACTIONS} --write-golden ${EXPECTED}` from the native-release build and commit it")
endif()

get_filename_component(NAME "${ACTIONS}" NAME_WE)
file(MAKE_DIRECTORY "${WORK}")

execute_process(COMMAND "${REPLAY}" "${ACTIONS}"
    OUTPUT_FILE "${WORK}/${NAME}.a" RESULT_VARIABLE rc_a)
execute_process(COMMAND "${REPLAY}" "${ACTIONS}"
    OUTPUT_FILE "${WORK}/${NAME}.b" RESULT_VARIABLE rc_b)
if(NOT rc_a EQUAL 0 OR NOT rc_b EQUAL 0)
    message(FATAL_ERROR "two_process.cmake: ${NAME}: the replay CLI exited ${rc_a} / ${rc_b}")
endif()

file(READ "${WORK}/${NAME}.a" a)
file(READ "${WORK}/${NAME}.b" b)
file(READ "${EXPECTED}" expected)
if(NOT a STREQUAL b)
    message(FATAL_ERROR "two_process.cmake: ${NAME}: two processes disagree\n--- a\n${a}--- b\n${b}")
endif()
if(NOT a STREQUAL expected)
    message(FATAL_ERROR "two_process.cmake: ${NAME}: replay differs from ${EXPECTED}\n--- got\n${a}--- expected\n${expected}")
endif()
if("${a}" STREQUAL "")
    message(FATAL_ERROR "two_process.cmake: ${NAME}: empty replay output")
endif()

execute_process(COMMAND "${REPLAY}" "${ACTIONS}" --roundtrip --compare "${EXPECTED}"
    OUTPUT_VARIABLE out_r ERROR_VARIABLE err_r RESULT_VARIABLE rc_r)
if(NOT rc_r EQUAL 0)
    message(FATAL_ERROR "two_process.cmake: ${NAME}: --roundtrip --compare exited ${rc_r}\n${out_r}${err_r}")
endif()

string(REGEX MATCHALL "\n" newlines "${a}")
list(LENGTH newlines lines)
message(STATUS "golden_two_process ${NAME}: two processes agree with ${EXPECTED} (${lines} checkpoints); roundtrip ok")
