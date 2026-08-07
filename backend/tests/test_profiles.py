from app.profiles import PROFILE_BY_ID


def test_minimax_short_duration_options_follow_frame_rule() -> None:
    profile = PROFILE_BY_ID["minimax-h3-diffsynth-fl2va"]

    assert profile.default_frames == 124
    assert {73, 90, 107, 124}.issubset(profile.frame_options)
    assert all((frames - 5) % 17 == 0 for frames in profile.frame_options)
    assert 3.0 < 73 / profile.fps < 3.1
    assert 3.7 < 90 / profile.fps < 3.8
    assert 4.4 < 107 / profile.fps < 4.5
